import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { lstat, opendir, readFile } from "node:fs/promises";
import {
  listMemoryRecords,
  rememberMemory,
  supersedeMemory,
  type MemoryEvidence,
  type MemoryRecord,
  type MemoryRecordStatus,
  type MemorySensitivity,
} from "../../../packages/manager/src/memory";
import type { SharedState } from "../../../packages/manager/src/state";
import { writeTextAtomic } from "../../../packages/manager/src/state-v2";
import {
  listSessions,
  loadSessionEvents,
  type SessionEvent,
} from "../../../packages/harness/session";

export const MEMORY_PLUGIN_SCHEMA_VERSION = 1 as const;
export const DREAM_V13_CURSOR_VERSION = "1.3" as const;
export const DEFAULT_DREAM_IDLE_MS = 30 * 60_000;

const SHA256 = /^[a-f0-9]{64}$/;
const MAX_CANDIDATE_TEXT = 480;
const DEFAULT_MAX_CORPUS_FILES = 1_000;
const DEFAULT_MAX_CORPUS_FILE_BYTES = 1024 * 1024;
const SECRET_PATTERNS = [
  /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/i,
  /\bsecret:\/\//i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,})\b/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /["']?(?:password|passwd|token|secret|api[_-]?key)["']?\s*(?::|=|\bis\b)\s*["']?[^\s"']{8,}/i,
];

export type MemoryCandidateKind = "reflection" | "dream" | "corpus";

export interface MemoryCandidate {
  schemaVersion: typeof MEMORY_PLUGIN_SCHEMA_VERSION;
  kind: MemoryCandidateKind;
  scope: string;
  subject: string;
  predicate: string;
  value: string;
  evidence: MemoryEvidence;
  sensitivity: Exclude<MemorySensitivity, "secret">;
  observedAt: string;
  status: Extract<MemoryRecordStatus, "active" | "disputed">;
}

export interface DreamCycleResult {
  status: "skipped" | "recorded";
  reason?: "no-sessions" | "not-idle";
  idleForMs?: number;
  candidate?: MemoryCandidate;
  record?: MemoryRecord;
}

export interface CorpusSkip {
  relativePath: string;
  reason: "unsupported" | "too-large" | "secret-like" | "no-candidate";
}

export interface CorpusBatchResult {
  candidates: MemoryCandidate[];
  skipped: CorpusSkip[];
}

export interface DreamV13Cursor {
  version: typeof DREAM_V13_CURSOR_VERSION;
  last_run: string;
  last_processed_file: string;
  processed_total: number;
  last_session_title: string;
  pending_count: number;
  open_items: string[];
  next_work: string[];
  source_counts: Record<string, number>;
  provider_counts: Record<string, number>;
}

export interface MigratedDreamCursor {
  schemaVersion: typeof MEMORY_PLUGIN_SCHEMA_VERSION;
  kind: "dream-v1.3-cursor";
  migratedAt: string;
  source: {
    uri: string;
    contentHash: string;
  };
  legacyCursor: DreamV13Cursor;
  canonicalCursor: {
    lastSessionEventAt: null;
    lastSessionEventHash: null;
  };
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function requiredTimestamp(value: unknown, label: string): string {
  const text = requiredText(value, label);
  if (!Number.isFinite(Date.parse(text))) throw new Error(`${label} must be an ISO timestamp`);
  return text;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${label} must be a non-negative integer`);
  return value as number;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${label} must be an array of strings`);
  }
  return [...value];
}

function countMap(value: unknown, label: string): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const output: Record<string, number> = {};
  for (const [key, count] of Object.entries(value)) {
    output[requiredText(key, `${label} key`)] = nonNegativeInteger(count, `${label}.${key}`);
  }
  return output;
}

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function containsSecretLikeText(value: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(value));
}

function candidateText(value: string): string | null {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || containsSecretLikeText(normalized)) return null;
  return normalized.length > MAX_CANDIDATE_TEXT ? `${normalized.slice(0, MAX_CANDIDATE_TEXT - 1)}…` : normalized;
}

function assistantTexts(events: SessionEvent[]): string[] {
  return events.flatMap((event) => {
    if (event.type !== "message.appended" || event.data.message.role !== "assistant") return [];
    const text = candidateText(event.data.message.content);
    return text ? [text] : [];
  });
}

function validateCandidate(candidate: MemoryCandidate): MemoryCandidate {
  if (candidate.schemaVersion !== MEMORY_PLUGIN_SCHEMA_VERSION) throw new Error("unsupported memory candidate schema");
  if (!SHA256.test(candidate.evidence.contentHash)) throw new Error("candidate evidence hash must be lowercase SHA-256");
  if (containsSecretLikeText(candidate.value) || candidate.sensitivity === ("secret" as MemorySensitivity)) {
    throw new Error("secret-like values cannot cross the memory plugin boundary");
  }
  requiredTimestamp(candidate.observedAt, "candidate observedAt");
  return candidate;
}

function latestEventAt(events: SessionEvent[]): string {
  const latest = events.at(-1)?.at;
  if (!latest) throw new Error("canonical session has no events");
  return latest;
}

export async function reflectCanonicalSession(
  state: SharedState,
  sessionId: string,
): Promise<MemoryCandidate> {
  const events = await loadSessionEvents(state, sessionId);
  if (events.length === 0) throw new Error(`canonical session not found: ${sessionId}`);
  const completedTurns = events.filter((event) => event.type === "turn.completed").length;
  if (completedTurns === 0) throw new Error(`canonical session has no completed turns: ${sessionId}`);
  const responses = assistantTexts(events);
  const latestResponse = responses.at(-1);
  const value = latestResponse
    ? `Completed ${completedTurns} turn${completedTurns === 1 ? "" : "s"}; latest reflection: ${latestResponse}`
    : `Completed ${completedTurns} turn${completedTurns === 1 ? "" : "s"}; assistant content was omitted by admission policy.`;
  return validateCandidate({
    schemaVersion: MEMORY_PLUGIN_SCHEMA_VERSION,
    kind: "reflection",
    scope: "reflection",
    subject: `session:${sessionId}`,
    predicate: "session-summary",
    value,
    evidence: {
      uri: `agent-session://${encodeURIComponent(sessionId)}/events`,
      contentHash: sha256(canonicalJson(events)),
      sourceClass: "inferred",
      confidence: latestResponse ? 0.8 : 0.65,
    },
    sensitivity: "internal",
    observedAt: latestEventAt(events),
    status: "active",
  });
}

export async function applyMemoryCandidate(
  state: SharedState,
  candidateInput: MemoryCandidate,
  options: { now?: Date; authorId?: string } = {},
): Promise<MemoryRecord> {
  const candidate = validateCandidate(candidateInput);
  const input = {
    scope: candidate.scope,
    subject: candidate.subject,
    predicate: candidate.predicate,
    value: candidate.value,
    evidence: candidate.evidence,
    sensitivity: candidate.sensitivity,
    observedAt: candidate.observedAt,
  };
  if (candidate.status === "disputed") {
    return rememberMemory(state, { ...input, status: "disputed" }, options);
  }
  const active = await listMemoryRecords(state, {
    scope: candidate.scope,
    subject: candidate.subject,
    predicate: candidate.predicate,
    status: "active",
  });
  if (active.length > 1) throw new Error("canonical memory contains multiple active records for the candidate key");
  if (active.length === 1) {
    if (
      active[0].value === candidate.value &&
      active[0].evidence.uri === candidate.evidence.uri &&
      active[0].evidence.contentHash === candidate.evidence.contentHash &&
      active[0].evidence.sourceClass === candidate.evidence.sourceClass &&
      active[0].evidence.confidence === candidate.evidence.confidence &&
      active[0].sensitivity === candidate.sensitivity
    ) {
      return active[0];
    }
    return supersedeMemory(state, active[0].id, input, options);
  }
  return rememberMemory(state, input, options);
}

export async function runIdleDreamCycle(
  state: SharedState,
  options: {
    now?: Date;
    minimumIdleMs?: number;
    maximumSessions?: number;
    authorId?: string;
  } = {},
): Promise<DreamCycleResult> {
  const now = options.now ?? new Date();
  const minimumIdleMs = options.minimumIdleMs ?? DEFAULT_DREAM_IDLE_MS;
  const maximumSessions = options.maximumSessions ?? 8;
  if (!Number.isFinite(minimumIdleMs) || minimumIdleMs < 0) throw new Error("minimumIdleMs must be non-negative");
  if (!Number.isSafeInteger(maximumSessions) || maximumSessions < 1 || maximumSessions > 100) {
    throw new Error("maximumSessions must be an integer between 1 and 100");
  }
  const descriptors = await listSessions(state);
  const sessions = await Promise.all(
    descriptors.map(async ({ sessionId }) => ({ sessionId, events: await loadSessionEvents(state, sessionId) })),
  );
  const nonEmpty = sessions.filter((session) => session.events.length > 0);
  if (nonEmpty.length === 0) return { status: "skipped", reason: "no-sessions" };
  const latestAt = nonEmpty
    .map((session) => latestEventAt(session.events))
    .sort((left, right) => right.localeCompare(left))[0];
  const idleForMs = now.getTime() - Date.parse(latestAt);
  if (idleForMs < minimumIdleMs) return { status: "skipped", reason: "not-idle", idleForMs };

  const selected = nonEmpty
    .sort((left, right) => latestEventAt(right.events).localeCompare(latestEventAt(left.events)))
    .slice(0, maximumSessions);
  const reflections = selected.flatMap(({ sessionId, events }) => {
    const response = assistantTexts(events).at(-1);
    return response ? [`${sessionId}: ${response}`] : [];
  });
  const value = candidateText(
    reflections.length > 0
      ? `Idle dream across ${selected.length} canonical session${selected.length === 1 ? "" : "s"}: ${reflections.join(" | ")}`
      : `Idle dream observed ${selected.length} canonical session${selected.length === 1 ? "" : "s"}; content was omitted by admission policy.`,
  );
  if (!value) throw new Error("dream output was rejected by admission policy");
  const evidencePayload = selected.map(({ sessionId, events }) => ({ sessionId, events }));
  const evidenceHash = sha256(canonicalJson(evidencePayload));
  const candidate = validateCandidate({
    schemaVersion: MEMORY_PLUGIN_SCHEMA_VERSION,
    kind: "dream",
    scope: "dream",
    subject: "idle-session-distillation",
    predicate: "summary",
    value,
    evidence: {
      uri: `agent-session-set://${evidenceHash.slice(0, 24)}`,
      contentHash: evidenceHash,
      sourceClass: "inferred",
      confidence: reflections.length > 0 ? 0.7 : 0.55,
    },
    sensitivity: "internal",
    observedAt: latestAt,
    status: "active",
  });
  const record = await applyMemoryCandidate(state, candidate, { now, authorId: options.authorId ?? "memory-plugin:dream" });
  return { status: "recorded", idleForMs, candidate, record };
}

async function corpusFiles(root: string, maxFiles: number): Promise<string[]> {
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("corpus root must be a regular directory");
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for await (const entry of await opendir(directory)) {
      const absolute = path.join(directory, entry.name);
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) throw new Error(`corpus links are not admitted: ${absolute}`);
      if (info.isDirectory()) await visit(absolute);
      else if (info.isFile()) {
        files.push(absolute);
        if (files.length > maxFiles) throw new Error(`corpus exceeds maximum file count ${maxFiles}`);
      } else {
        throw new Error(`corpus contains an unsupported filesystem entry: ${absolute}`);
      }
    }
  };
  await visit(root);
  return files.sort((left, right) => left.localeCompare(right));
}

function findMessageContent(value: unknown, output: string[]): void {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let visited = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    visited += 1;
    if (visited > 10_000 || current.depth > 64) return;
    if (Array.isArray(current.value)) {
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        stack.push({ value: current.value[index], depth: current.depth + 1 });
      }
      continue;
    }
    if (!current.value || typeof current.value !== "object") continue;
    const object = current.value as Record<string, unknown>;
    if (
      typeof object.content === "string" &&
      (object.role === "assistant" || object.type === "assistant" || object.role === "user")
    ) {
      output.push(object.content);
    }
    const children = Object.values(object);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ value: children[index], depth: current.depth + 1 });
    }
  }
}

function extractCorpusCandidate(content: string, extension: string): string | null {
  const messages: string[] = [];
  if (extension === ".jsonl") {
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        findMessageContent(JSON.parse(line), messages);
      } catch {
        continue;
      }
    }
  } else if (extension === ".json") {
    try {
      findMessageContent(JSON.parse(content), messages);
    } catch {
      return null;
    }
  } else {
    messages.push(content);
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const admitted = candidateText(messages[index]);
    if (admitted) return admitted;
  }
  return null;
}

export async function processHistoricalCorpus(
  rootInput: string,
  options: { maxFiles?: number; maxFileBytes?: number; observedAt?: Date } = {},
): Promise<CorpusBatchResult> {
  const root = path.resolve(rootInput);
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_CORPUS_FILES;
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_CORPUS_FILE_BYTES;
  if (!Number.isSafeInteger(maxFiles) || maxFiles < 1) throw new Error("maxFiles must be a positive integer");
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes < 1) throw new Error("maxFileBytes must be a positive integer");
  const candidates: MemoryCandidate[] = [];
  const skipped: CorpusSkip[] = [];
  for (const absolute of await corpusFiles(root, maxFiles)) {
    const relativePath = path.relative(root, absolute).split(path.sep).join("/");
    if (!relativePath || relativePath.startsWith("../") || path.isAbsolute(relativePath)) {
      throw new Error(`corpus path escaped its declared root: ${absolute}`);
    }
    const extension = path.extname(absolute).toLowerCase();
    if (![".json", ".jsonl", ".md", ".txt"].includes(extension)) {
      skipped.push({ relativePath, reason: "unsupported" });
      continue;
    }
    const info = await lstat(absolute);
    if (info.size > maxFileBytes) {
      skipped.push({ relativePath, reason: "too-large" });
      continue;
    }
    const bytes = await readFile(absolute);
    const content = bytes.toString("utf8");
    if (containsSecretLikeText(content)) {
      skipped.push({ relativePath, reason: "secret-like" });
      continue;
    }
    const value = extractCorpusCandidate(content, extension);
    if (!value) {
      skipped.push({ relativePath, reason: "no-candidate" });
      continue;
    }
    candidates.push(
      validateCandidate({
        schemaVersion: MEMORY_PLUGIN_SCHEMA_VERSION,
        kind: "corpus",
        scope: "corpus",
        subject: `file:${relativePath}`,
        predicate: "historical-candidate",
        value,
        evidence: {
          uri: pathToFileURL(absolute).href,
          contentHash: sha256(bytes),
          sourceClass: "inferred",
          confidence: 0.5,
        },
        sensitivity: "internal",
        observedAt: (options.observedAt ?? info.mtime).toISOString(),
        status: "active",
      }),
    );
  }
  return { candidates, skipped };
}

function validateDreamV13Cursor(value: unknown): DreamV13Cursor {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Dream cursor must be an object");
  const cursor = value as Record<string, unknown>;
  const expectedKeys = new Set([
    "version",
    "last_run",
    "last_processed_file",
    "processed_total",
    "last_session_title",
    "pending_count",
    "open_items",
    "next_work",
    "source_counts",
    "provider_counts",
  ]);
  const unexpected = Object.keys(cursor).filter((key) => !expectedKeys.has(key));
  if (unexpected.length > 0) throw new Error(`Dream cursor contains unsupported fields: ${unexpected.sort().join(", ")}`);
  if (cursor.version !== DREAM_V13_CURSOR_VERSION) {
    throw new Error(`Dream cursor must be version ${DREAM_V13_CURSOR_VERSION}; earlier formats remain retired`);
  }
  const validated = {
    version: DREAM_V13_CURSOR_VERSION,
    last_run: requiredTimestamp(cursor.last_run, "Dream cursor last_run"),
    last_processed_file: requiredText(cursor.last_processed_file, "Dream cursor last_processed_file"),
    processed_total: nonNegativeInteger(cursor.processed_total, "Dream cursor processed_total"),
    last_session_title: requiredText(cursor.last_session_title, "Dream cursor last_session_title"),
    pending_count: nonNegativeInteger(cursor.pending_count, "Dream cursor pending_count"),
    open_items: stringArray(cursor.open_items, "Dream cursor open_items"),
    next_work: stringArray(cursor.next_work, "Dream cursor next_work"),
    source_counts: countMap(cursor.source_counts, "Dream cursor source_counts"),
    provider_counts: countMap(cursor.provider_counts, "Dream cursor provider_counts"),
  };
  const sourceTotal = Object.values(validated.source_counts).reduce((sum, count) => sum + count, 0);
  const providerTotal = Object.values(validated.provider_counts).reduce((sum, count) => sum + count, 0);
  if (sourceTotal !== validated.processed_total || providerTotal !== validated.processed_total) {
    throw new Error("Dream cursor processed_total must match both source and provider counts");
  }
  return validated;
}

export function dreamCursorPath(state: SharedState): string {
  return path.join(state.stateDir, "runtime", "plugins", "memory", "dream-v1.3-cursor.json");
}

export async function migrateDreamV13Cursor(
  state: SharedState,
  sourcePathInput: string,
  options: { now?: Date } = {},
): Promise<MigratedDreamCursor> {
  const sourcePath = path.resolve(sourcePathInput);
  const sourceInfo = await lstat(sourcePath);
  if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) throw new Error("Dream cursor source must be a regular file");
  if (sourceInfo.size > 1024 * 1024) throw new Error("Dream cursor source exceeds the admission size limit");
  const sourceBytes = await readFile(sourcePath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(sourceBytes.toString("utf8"));
  } catch {
    throw new Error("Dream cursor source is not valid JSON");
  }
  const sourceHash = sha256(sourceBytes);
  const destination = dreamCursorPath(state);
  try {
    const existingInfo = await lstat(destination);
    if (!existingInfo.isFile() || existingInfo.isSymbolicLink()) {
      throw new Error("migrated Dream cursor destination must be a regular file");
    }
    const existing = JSON.parse(await readFile(destination, "utf8")) as MigratedDreamCursor;
    if (existing.source?.contentHash !== sourceHash) {
      throw new Error("a different Dream cursor has already been migrated; refusing to overwrite preserved state");
    }
    validateDreamV13Cursor(existing.legacyCursor);
    return existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const migrated: MigratedDreamCursor = {
    schemaVersion: MEMORY_PLUGIN_SCHEMA_VERSION,
    kind: "dream-v1.3-cursor",
    migratedAt: (options.now ?? new Date()).toISOString(),
    source: { uri: pathToFileURL(sourcePath).href, contentHash: sourceHash },
    legacyCursor: validateDreamV13Cursor(parsed),
    canonicalCursor: { lastSessionEventAt: null, lastSessionEventHash: null },
  };
  await writeTextAtomic(destination, `${JSON.stringify(migrated, null, 2)}\n`);
  return migrated;
}
