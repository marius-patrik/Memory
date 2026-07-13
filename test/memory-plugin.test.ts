import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile, mkdir, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  inspectMemoryIntegrity,
  listMemoryRecords,
  rebuildMemoryProjections,
  renderStartupMemory,
} from "../../../packages/manager/src/memory";
import { ensureSharedState, sharedStateAt, type SharedState } from "../../../packages/manager/src/state";
import { createSession, loadSessionEvents, withSessionWriteTransaction } from "../../../packages/harness/session";
import {
  applyMemoryCandidate,
  dreamCursorPath,
  migrateDreamV13Cursor,
  processHistoricalCorpus,
  reflectCanonicalSession,
  runIdleDreamCycle,
  type DreamV13Cursor,
} from "../src/index";

async function fixture(): Promise<{ root: string; state: SharedState }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "andromeda-memory-plugin-"));
  const state = sharedStateAt(root, path.join(root, ".agents"), path.join(root, "user"));
  await ensureSharedState(state);
  return { root, state };
}

async function completeSession(state: SharedState, sessionId: string, response: string): Promise<void> {
  await createSession(state, {
    sessionId,
    provider: "test-provider",
    model: "test-model",
    workdir: state.root,
  });
  await withSessionWriteTransaction(state, sessionId, async (transaction) => {
    const turnId = await transaction.beginTurn();
    await transaction.appendMessage(turnId, { role: "user", content: "Please capture the durable result." });
    await transaction.appendMessage(turnId, { role: "assistant", content: response });
    await transaction.completeTurn(turnId, { finishReason: "stop" });
  });
}

describe("canonical reflection and dreams", () => {
  test("reflects a real canonical session and survives replay and startup projection", async () => {
    const { root, state } = await fixture();
    try {
      await completeSession(state, "reflection-session", "The user prefers concise progress updates.");
      const candidate = await reflectCanonicalSession(state, "reflection-session");
      const recordedAt = new Date(Date.parse(candidate.observedAt) + 2 * 60 * 60_000);
      const record = await applyMemoryCandidate(state, candidate, {
        now: recordedAt,
        authorId: "memory-plugin:reflection",
      });

      expect(record.scope).toBe("reflection");
      expect(record.value).toContain("The user prefers concise progress updates.");
      expect(record.evidence.uri).toBe("agent-session://reflection-session/events");
      expect(record.evidence.contentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(record.evidence.sourceClass).toBe("inferred");

      const replay = await rebuildMemoryProjections(state);
      const startup = await renderStartupMemory(state);
      expect(replay.records).toBe(1);
      expect(startup.content).toContain("The user prefers concise progress updates.");
      expect(startup.content).toContain("source agent-session://reflection-session/events");
      expect(startup.content).toContain("age 2h");
      expect((await inspectMemoryIntegrity(state)).ok).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("runs only while idle and supersedes the previous dream through canonical mutation", async () => {
    const { root, state } = await fixture();
    try {
      await completeSession(state, "dream-one", "Keep evidence links beside each conclusion.");
      const firstEvents = await loadSessionEvents(state, "dream-one");
      const latestFirst = Date.parse(firstEvents.at(-1)!.at);

      const awake = await runIdleDreamCycle(state, {
        now: new Date(latestFirst),
        minimumIdleMs: 60 * 60_000,
      });
      expect(awake).toMatchObject({ status: "skipped", reason: "not-idle" });
      expect(await listMemoryRecords(state, { scope: "dream" })).toEqual([]);

      const first = await runIdleDreamCycle(state, {
        now: new Date(latestFirst + 2 * 60 * 60_000),
        minimumIdleMs: 60 * 60_000,
      });
      expect(first.status).toBe("recorded");
      expect(first.record?.value).toContain("Keep evidence links beside each conclusion.");
      expect((await renderStartupMemory(state)).content).toContain("age 2h");

      await completeSession(state, "dream-two", "Preserve unrelated worktree changes.");
      const secondEvents = await loadSessionEvents(state, "dream-two");
      const latestSecond = Date.parse(secondEvents.at(-1)!.at);
      const second = await runIdleDreamCycle(state, {
        now: new Date(latestSecond + 3 * 60 * 60_000),
        minimumIdleMs: 60 * 60_000,
      });
      expect(second.status).toBe("recorded");
      expect(second.record?.id).not.toBe(first.record?.id);

      const records = await listMemoryRecords(state, { scope: "dream" });
      expect(records.filter((record) => record.status === "active")).toHaveLength(1);
      expect(records.filter((record) => record.status === "superseded")).toHaveLength(1);
      expect(records.find((record) => record.status === "active")?.value).toContain("Preserve unrelated worktree changes.");
      expect((await inspectMemoryIntegrity(state)).ok).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("omits secret-like session content from both reflection and dream records", async () => {
    const { root, state } = await fixture();
    try {
      const secret = "api_key=secret-value-that-must-not-cross";
      await completeSession(state, "secret-session", secret);
      const reflection = await reflectCanonicalSession(state, "secret-session");
      expect(reflection.value).toContain("omitted by admission policy");
      expect(reflection.value).not.toContain(secret);

      const events = await loadSessionEvents(state, "secret-session");
      const dream = await runIdleDreamCycle(state, {
        now: new Date(Date.parse(events.at(-1)!.at) + 2 * 60 * 60_000),
        minimumIdleMs: 60 * 60_000,
      });
      expect(dream.status).toBe("recorded");
      expect(dream.record?.value).toContain("content was omitted by admission policy");
      expect((await renderStartupMemory(state)).content).not.toContain(secret);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("historical corpus admission", () => {
  test("produces provenance-visible candidates without mutating memory until explicitly applied", async () => {
    const { root, state } = await fixture();
    try {
      const corpus = path.join(root, "corpus");
      await mkdir(corpus, { recursive: true });
      await writeFile(
        path.join(corpus, "session.jsonl"),
        `${JSON.stringify({ role: "assistant", content: "Historical sessions favor direct technical action." })}\n`,
      );
      await writeFile(path.join(corpus, "secret.txt"), "api_key=secret-value-that-must-not-cross\n");
      await writeFile(path.join(corpus, "binary.bin"), "ignored\n");

      const batch = await processHistoricalCorpus(corpus, { observedAt: new Date("2026-07-06T12:00:00.000Z") });
      expect(batch.candidates).toHaveLength(1);
      expect(batch.candidates[0]).toMatchObject({
        kind: "corpus",
        subject: "file:session.jsonl",
        predicate: "historical-candidate",
        value: "Historical sessions favor direct technical action.",
      });
      expect(batch.candidates[0].evidence.uri).toStartWith("file:");
      expect(batch.skipped).toEqual([
        { relativePath: "binary.bin", reason: "unsupported" },
        { relativePath: "secret.txt", reason: "secret-like" },
      ]);
      expect(await listMemoryRecords(state)).toEqual([]);

      await applyMemoryCandidate(state, batch.candidates[0], {
        now: new Date("2026-07-06T13:00:00.000Z"),
        authorId: "memory-plugin:corpus",
      });
      const records = await listMemoryRecords(state, { scope: "corpus" });
      expect(records).toHaveLength(1);
      expect(records[0].evidence.sourceClass).toBe("inferred");
      expect((await readFile(new URL(records[0].evidence.uri), "utf8"))).toContain("Historical sessions");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects a linked corpus root", async () => {
    const { root } = await fixture();
    try {
      const target = path.join(root, "corpus-target");
      const link = path.join(root, "corpus-link");
      await mkdir(target, { recursive: true });
      await symlink(target, link, process.platform === "win32" ? "junction" : "dir");
      await expect(processHistoricalCorpus(link)).rejects.toThrow(/regular directory/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("Dream v1.3 cursor migration", () => {
  const cursor: DreamV13Cursor = {
    version: "1.3",
    last_run: "2026-07-06T13:59:13.0874487+02:00",
    last_processed_file:
      "20260706113120000|claude|provider_raw|c:\\users\\patrik\\.claude\\projects\\session.jsonl",
    processed_total: 368,
    last_session_title: "session.jsonl",
    pending_count: 0,
    open_items: [],
    next_work: [],
    source_counts: { rollout_summary: 21, provider_raw: 347 },
    provider_counts: { claude: 165, kimi: 31, codex: 166, agy: 6 },
  };

  test("preserves the full v1.3 cursor and source bytes while rejecting older formats", async () => {
    const { root, state } = await fixture();
    try {
      const oldSource = path.join(root, "dream-v1.1.json");
      await writeFile(oldSource, `${JSON.stringify({ ...cursor, version: "1.1" }, null, 2)}\n`);
      await expect(migrateDreamV13Cursor(state, oldSource)).rejects.toThrow(/must be version 1\.3/);

      const source = path.join(root, "dream-v1.3.json");
      const sourceBytes = `${JSON.stringify(cursor, null, 2)}\n`;
      await writeFile(source, sourceBytes);
      const migrated = await migrateDreamV13Cursor(state, source, {
        now: new Date("2026-07-13T12:00:00.000Z"),
      });

      expect(migrated.legacyCursor).toEqual(cursor);
      expect(migrated.legacyCursor.processed_total).toBe(368);
      expect(migrated.legacyCursor.source_counts).toEqual({ rollout_summary: 21, provider_raw: 347 });
      expect(migrated.legacyCursor.provider_counts).toEqual({ claude: 165, kimi: 31, codex: 166, agy: 6 });
      expect(migrated.canonicalCursor).toEqual({ lastSessionEventAt: null, lastSessionEventHash: null });
      expect(migrated.source.contentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(await readFile(source, "utf8")).toBe(sourceBytes);

      const repeated = await migrateDreamV13Cursor(state, source, {
        now: new Date("2026-07-14T12:00:00.000Z"),
      });
      expect(repeated).toEqual(migrated);
      const onDisk = JSON.parse(await readFile(dreamCursorPath(state), "utf8"));
      expect(onDisk).toEqual(migrated);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
