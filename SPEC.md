# Universal Agent Memory

## Architecture Specification

### Status

Initial architecture specification.

The system provides persistent, model-assisted memory to arbitrary AI agents and agent harnesses while remaining independent of any specific model provider, agent runtime, or memory vendor.

The initial implementation targets:

- Claude Code
- OpenCode
- Codex and OpenAI-compatible agents
- Agents-compatible runtimes
- arbitrary future agent harnesses
- MCP clients
- direct human and agent use through a CLI

The core system is local-first, CLI-first, and runtime-independent.

---

## 1. Objective

Build a universal memory system that can sit underneath essentially any AI agent.

The system must:

1. observe everything that enters an agent's model context;
2. continuously convert relevant observations into durable structured memory;
3. retrieve relevant memories before inference;
4. inject compiled memory context into the current model request;
5. expose memory directly to agents through MCP;
6. expose the same functionality to agents and humans through a CLI;
7. use specialized models for classification, extraction, embeddings, reranking, reasoning, and consolidation;
8. bind to external model infrastructure such as LiteLLM rather than embedding or reimplementing it;
9. preserve exact event history and provenance;
10. remain independent of any particular agent harness.

The system is not merely a vector database or RAG layer.

It is the persistent state substrate of the agent.

---

## 2. Core Principle

The central architectural rule is:

> **Automatic memory happens at the inference boundary; native agent hooks enrich it; MCP exposes it; the CLI controls it; LiteLLM supplies model capabilities; none of those surfaces owns the memory itself.**

All integrations converge on one shared memory runtime.

```text
                       ┌─────────────────────┐
                       │    Memory Runtime   │
                       │                     │
                       │ ledger / memories   │
                       │ graph / vectors     │
                       │ retrieval / models  │
                       │ consolidation       │
                       └─────────┬───────────┘
                                 │
          ┌──────────────┬───────┼────────┬──────────────┐
          │              │       │        │              │
          ▼              ▼       ▼        ▼              ▼
        CLI           Plugins    MCP      SDK       Model Proxy
```

No plugin, MCP server, proxy, or CLI command may implement its own independent memory semantics.

They are all interfaces over the same runtime.

---

## 3. Memory Is Not a Vector Database

The system distinguishes between several forms of memory.

### 3.1 Event Memory

The event ledger is the immutable historical ground truth.

Examples:

```text
User sent prompt X.
Assistant generated response Y.
Tool Z returned result Q.
File A changed.
Test B failed.
Context projection C was injected.
```

Events are append-only.

Derived memories may change, merge, become obsolete, or be superseded.

The historical event ledger does not.

Everything else should remain reconstructable from source evidence.

### 3.2 Episodic Memory

Events are grouped into meaningful episodes.

```text
Episode: Memory architecture design
├── user requirements
├── proposed architecture
├── decisions
├── rejected alternatives
├── implementation changes
└── resulting state
```

Episodes give events temporal, causal, and semantic continuity.

### 3.3 Semantic Memory

Semantic memory represents propositions currently believed to be true.

A fact should not be represented merely as text.

```ts
type Assertion = {
  id: AssertionId

  subject: EntityId
  predicate: RelationId
  object: Value | EntityId

  validFrom?: Time
  validUntil?: Time

  observedAt: Time

  confidence: number

  evidence: EventId[]

  supersedes?: AssertionId[]
  contradictions?: AssertionId[]
}
```

Changing facts therefore become temporal state transitions rather than destructive overwrites.

```text
Framework(Project, React)
valid: T1 → T2

Framework(Project, Svelte)
valid: T2 → present
```

---

## 4. Memory Types

The runtime should support at least the following first-class memory types:

```text
event
episode
assertion
concept
entity
relationship
decision
goal
commitment
preference
procedure
skill
artifact
expectation
project-state
```

These types may share a common underlying representation while preserving specialized semantics.

---

## 5. Relational Memory

Memory should form a graph.

Entities may include:

```text
Person
Agent
Worker
Project
Repository
File
Document
Function
Tool
Model
Organization
Concept
Decision
Goal
Procedure
Episode
Event
Artifact
Service
Environment
```

Relations are first-class.

```text
DarkFactory
    IMPLEMENTS → AgentHarness

AgentHarness
    DEPENDS_ON → MemoryRuntime

MemoryRuntime
    USES → EventLedger
```

Relations should themselves be able to carry:

- confidence;
- provenance;
- temporal validity;
- metadata;
- importance;
- contradictions.

The graph enables associative recall beyond vector similarity.

---

## 6. Procedural Memory

The system must remember not only facts but how actions are performed.

```text
Procedure: release project

Preconditions
Inputs
Steps
Tools
Expected observations
Failure conditions
Recovery steps
Verification
Known exceptions
```

Repeated successful episodes may eventually produce candidate procedures.

```text
repeated episodes
      ↓
pattern discovery
      ↓
candidate procedure
      ↓
validation
      ↓
durable procedure
      ↓
skill / automation
```

This allows experience to become capability.

---

## 7. Preferences

Preferences require explicit scope.

A statement such as:

```text
User prefers concise answers.
```

is too broad.

Instead:

```ts
type Preference = {
  target: string
  property: string
  value: unknown

  scope?: Scope

  strength: number
  confidence: number

  evidence: EventId[]
}
```

Example:

```text
target: answers
property: verbosity
value: concise
scope: school exercises
```

This prevents isolated interactions from becoming universal assumptions.

---

## 8. Goal and Project Memory

Long-running work requires explicit persistent state.

A project memory should expose:

```text
Project
├── objective
├── constraints
├── architecture
├── current state
├── decisions
├── unresolved questions
├── active plans
├── completed work
├── artifacts
├── dependencies
├── blockers
└── possible next actions
```

This replaces repeated conversation summarization with an actual evolving model of the project.

---

## 9. Expectations and Predictive Memory

The system should also learn what commonly happens next.

```ts
type Expectation = {
  condition: Pattern
  predictedEvent: Pattern

  probability: number
  confidence: number

  evidence: MemoryId[]
}
```

Examples:

```text
source code changed
→ tests are likely to run

CI formatting failure
→ formatter invocation usually resolves it

user says "continue"
→ current active project likely remains the intended subject
```

This turns memory into the beginning of a learned world model rather than a passive archive.

---

## 10. Canonical Memory Primitive

Most durable derived memories should map onto a shared structure.

```ts
type Memory = {
  id: MemoryId

  kind:
    | "episode"
    | "assertion"
    | "concept"
    | "procedure"
    | "preference"
    | "goal"
    | "decision"
    | "commitment"
    | "artifact"
    | "expectation"
    | "relationship"

  content: StructuredValue

  entities: EntityId[]
  concepts: ConceptId[]
  relations: Relation[]

  eventTime?: Interval
  knowledgeTime: Interval

  confidence: number

  evidence: EvidenceRef[]

  contradictions: MemoryId[]
  supersedes: MemoryId[]

  importance: number
  novelty: number
  utility: number

  accessFrequency: number
  lastActivated?: Time

  lexicalTerms: string[]

  embeddings: VectorRef[]

  structuralRepresentation?: StructuralRef

  abstractionLevel: number

  retentionClass: RetentionClass
  privacy: PrivacyPolicy
}
```

An embedding is only one representation of a memory.

```text
Memory ≠ Vector

Memory
 ├── semantics
 ├── provenance
 ├── temporal state
 ├── graph position
 ├── lexical representation
 ├── structural representation
 └── vector representation
```

---

## 11. Multiple Representations

One observed event may be represented simultaneously as:

```text
raw source
text
embedding
entities
graph relationships
temporal relationships
semantic assertions
AST
S-expression
concepts
episode membership
```

Example source:

```text
The memory worker must never directly modify the event ledger.
```

Possible representations:

```text
TEXT

"The memory worker must never directly modify the event ledger."
```

```text
SEMANTIC

(memory-worker, forbidden-action, event-ledger.write)
```

```text
GRAPH

MemoryWorker ──MUST_NOT_WRITE──> EventLedger
```

```lisp
(rule
  (subject memory-worker)
  (forbid
    (write event-ledger)))
```

```text
VECTOR

embedding(...)
```

```text
PROVENANCE

event://session/abc/982814
```

The architecture therefore combines neural and symbolic memory rather than choosing one.

---

## 12. Universal Context Interception

The system must attempt to observe literally everything entering a model context window.

Native agent hooks alone are insufficient because runtimes expose different lifecycle APIs.

The canonical interception layer is immediately before inference.

```text
Agent Runtime
     │
     │ model request
     ▼
┌───────────────────┐
│   Memory Proxy    │
│                   │
│ observe context   │
│ update memory     │
│ retrieve memory   │
│ inject context    │
└─────────┬─────────┘
          │
          ▼
       LiteLLM
          │
          ▼
        Model
```

The proxy should support common model protocols such as:

```text
/v1/messages
/v1/responses
/v1/chat/completions
```

Additional protocols may be added through adapters.

The desired invariant is:

> **If information is about to enter model inference, the memory system sees it before the model does.**

---

## 13. Native Agent Hooks

Native integrations remain valuable.

They can expose semantic information that is difficult to infer from the raw model request.

Examples:

```text
user prompt
tool invocation
tool result
file read
file modification
subagent result
compaction event
session transition
permission event
command execution
```

Native hooks therefore enrich the canonical context interception pipeline.

They do not own memory.

```text
native hook
     │
     ▼
normalized HostEvent
     │
     ▼
Memory Runtime
```

---

## 14. Per-Inference Transaction

Every inference should conceptually execute one memory transaction.

```text
MODEL REQUEST
     │
     ▼
1. Normalize incoming context
     │
     ▼
2. Diff against previously observed context
     │
     ▼
3. Record newly observed source events
     │
     ▼
4. Understand relevant new events
     │
     ├── classify
     ├── extract entities
     ├── extract assertions
     ├── extract goals
     ├── extract decisions
     ├── extract preferences
     ├── detect contradictions
     └── generate representations
     │
     ▼
5. Commit memory mutations
     │
     ▼
6. Determine current retrieval intent
     │
     ▼
7. Retrieve candidate memories
     │
     ├── graph
     ├── vector
     ├── lexical
     ├── temporal
     ├── structural
     └── procedural
     │
     ▼
8. Rerank
     │
     ▼
9. Compile working context
     │
     ▼
10. Inject context
     │
     ▼
11. Forward request
     │
     ▼
12. Observe generated response
     │
     ▼
13. Record response event
```

Steps required for the current inference are synchronous.

Heavy consolidation does not need to block the request.

---

## 15. Context Deduplication

Agent APIs commonly retransmit existing conversation history.

For example:

```text
request 1:
[A]

request 2:
[A B]

request 3:
[A B C D]
```

The memory system must observe the complete context but must not repeatedly learn `A`.

Every normalized context item receives a stable content identity.

```ts
type ContextItem = {
  id: string

  session: string
  request: string

  role:
    | "system"
    | "developer"
    | "user"
    | "assistant"
    | "tool"

  kind: string

  content: Content

  hash: string

  source?: SourceRef

  ordinal: number
}
```

Processing becomes:

```text
context item
     │
     ▼
seen before?
   │
   ├── yes
   │    └── register observation
   │
   └── no
        └── create canonical event
             └── run memory extraction
```

This preserves complete context observation without repeatedly generating duplicate memories.

---

## 16. Preventing Memory Feedback Loops

Injected memory will often appear again in future context requests.

The system must distinguish:

```text
SOURCE EVENT

versus

DERIVED MEMORY PROJECTION
```

A memory projection should be observable for auditing.

It should not normally be treated as new evidence.

Otherwise:

```text
memory
  ↓
projection
  ↓
model context
  ↓
memory extractor
  ↓
same memory
  ↓
new projection
  ↓
...
```

would create semantic amplification.

Every generated projection therefore carries an identity.

Example:

```xml
<memory-context
  projection="projection_01H..."
  generated="2026-10-03T19:00:00Z">

  ...

</memory-context>
```

When later observed, the runtime records that the projection re-entered context but does not relearn it as source knowledge.

---

## 17. Model Capability Layer

The memory project must not embed LiteLLM.

LiteLLM is an external model capability provider.

The runtime defines abstract capabilities.

```ts
interface Models {
  classify: Classifier
  extract: Generator
  embed: Embedder
  rerank: Reranker
  reason: Generator
  consolidate: Generator
}
```

The initial binding can be:

```text
LiteLLMModels implements Models
```

The memory runtime should not care which provider ultimately serves a model.

---

## 18. Model Roles

Different memory operations should use different models.

```text
incoming event
     │
     ▼
classifier
     │
     ├── irrelevant
     │      └── stop
     │
     └── relevant
            │
            ▼
        extractor
            │
       ┌────┴────┐
       ▼         ▼
   embedding   semantics
       │         │
       └────┬────┘
            ▼
         storage
```

Retrieval:

```text
query
  │
  ├── graph search
  ├── lexical search
  ├── vector search
  ├── temporal search
  └── structural search
          │
          ▼
        reranker
          │
          ▼
   context compiler
```

A stronger reasoning model should only activate where simpler methods are insufficient.

Examples:

```text
ambiguous contradiction
complex entity resolution
uncertain temporal interpretation
high-level consolidation
procedure induction
```

Most memory operations should not require a large reasoning model.

---

## 19. LiteLLM Binding

Initial configuration may resemble:

```yaml
models:
  baseUrl: http://localhost:4000
  apiKey: ${LITELLM_API_KEY}

  classify:
    model: memory-classifier

  extract:
    model: memory-extractor

  embed:
    model: memory-embedding

  rerank:
    model: memory-reranker

  reason:
    model: memory-reasoner

  consolidate:
    model: memory-consolidator
```

These are logical model roles rather than hardcoded provider model names.

LiteLLM may route them to:

- OpenAI;
- Anthropic;
- Gemini;
- local inference;
- dedicated embedding models;
- dedicated rerankers;
- specialized classifiers;
- custom endpoints.

The memory runtime only depends on capability contracts.

---

## 20. Classifiers

Classification should remain abstract.

```ts
interface Classifier {
  classify<T extends ClassificationSchema>(
    input: ClassificationInput,
    schema: T
  ): Promise<ClassificationResult<T>>
}
```

Possible implementations include:

```text
dedicated classification model
LiteLLM classifier binding
small structured-output LLM
local classifier
custom external service
```

The rest of the memory engine should not care which implementation is active.

---

## 21. Runtime

The canonical process should be a local daemon.

Working name:

```text
memd
```

Responsibilities:

```text
event ingestion
memory mutation
storage
entity resolution
graph maintenance
retrieval
context compilation
model invocation
consolidation
session tracking
projection tracking
```

Communication can initially use:

```text
Unix socket
or
localhost HTTP
```

The transport should remain replaceable.

---

## 22. Internal Runtime API

A possible internal API:

```text
POST /v1/events/observe

POST /v1/context/compile

POST /v1/memories
GET  /v1/memories/:id
DELETE /v1/memories/:id

POST /v1/search

POST /v1/remember
POST /v1/forget

POST /v1/consolidate

GET /v1/entities/:id
GET /v1/entities/:id/relations

GET /v1/sessions/:id
GET /v1/sessions/:id/events

GET /v1/projects/:id

GET /v1/status
```

This API is primarily an implementation boundary.

The primary public interaction surface remains the CLI.

---

## 23. CLI-First Design

The system is fundamentally a CLI application.

Everything meaningful should be possible directly through the CLI.

Example:

```bash
mem remember "The project uses SQLite"

mem recall "database decisions"

mem search "agent memory architecture"

mem context "I am implementing retrieval"

mem inspect mem_01HXYZ

mem entity DarkFactory

mem relations DarkFactory

mem events

mem events --session abc

mem sessions

mem forget mem_01HXYZ

mem consolidate

mem status

mem doctor

mem serve

mem proxy

mem mcp
```

Both humans and agents may use this interface.

The CLI is not merely an administration interface.

It is a first-class agent tool.

---

## 24. CLI Invariant

The architecture should aim for:

> Anything available through MCP should also be available through the CLI.

and:

> Any memory operation exposed by an agent plugin should have a corresponding runtime or CLI operation where meaningful.

This ensures no integration becomes privileged.

---

## 25. MCP Server

The project should expose an MCP server over the same runtime.

Automatic memory ingestion should not depend on MCP.

MCP provides explicit agent-controlled interaction with memory.

Example tools:

```text
memory_search
memory_recall
memory_remember
memory_forget
memory_inspect
memory_context
memory_entity
memory_relations
memory_history
```

Possible resources:

```text
memory://user

memory://project/current

memory://project/<id>

memory://entity/<id>

memory://episode/<id>

memory://session/<id>

memory://memory/<id>
```

This gives agents an explicit way to request additional information that was intentionally omitted from automatically injected context.

---

## 26. Automatic vs Explicit Memory

These must remain separate.

### Automatic

Handled by the inference interception layer.

```text
observe context
update memory
retrieve
inject
```

No agent decision is required.

### Explicit

Handled through:

```text
CLI
MCP
SDK
```

Examples:

```text
"Search memory for our previous database decision."

"Remember this permanently."

"Show the complete episode."

"Forget this information."

"Inspect the evidence for this belief."
```

The two systems share the same memory runtime.

---

## 27. Agent Adapter Architecture

Host-specific integrations should remain thin.

```ts
interface AgentAdapter {
  id: string

  install(): Promise<void>

  observe(
    event: HostEvent
  ): Promise<void>

  inject(
    context: HostContext,
    memory: CompiledContext
  ): Promise<HostContext>

  identity(): Promise<AgentIdentity>
}
```

Adapters should translate host semantics into the canonical runtime schema.

They should not contain memory logic.

---

## 28. Initial Agent Integrations

Initial adapters:

```text
Claude Code
OpenCode
Codex
OpenAI-compatible agents
generic inference proxy
```

Additional ecosystems should be supportable without changing the core runtime.

The fallback integration for an otherwise unsupported agent is:

```text
Model Proxy
+
MCP
+
CLI
```

This should already provide useful universal compatibility.

---

## 29. Plugin Packaging

Where supported, an agent plugin may package multiple integration mechanisms.

For example:

```text
Claude plugin
├── lifecycle hooks
├── MCP configuration
├── CLI discovery
└── runtime configuration
```

OpenCode may integrate at its own model-context hook.

Another agent may only use the inference proxy.

All ultimately target:

```text
Memory Runtime
```

---

## 30. SDK

A small programmatic SDK should expose the same core operations.

Example TypeScript API:

```ts
const memory = createMemoryClient()

await memory.remember({
  content: "The project uses SQLite",
})

const result = await memory.recall({
  query: "database architecture",
})

const context = await memory.compileContext({
  task: "implement persistence",
})
```

The SDK is primarily useful for:

- custom harnesses;
- plugins;
- tests;
- first-party integrations;
- embedded application usage.

---

## 31. Storage

The memory database belongs to the memory runtime.

It should not be delegated to LiteLLM.

Initial authoritative storage should be local and simple.

A strong initial choice is:

```text
SQLite
```

SQLite can contain:

```text
events
context_observations

memories
assertions
episodes
procedures
preferences
goals
decisions
expectations

entities
relations

evidence
supersessions
contradictions

memory_embeddings
memory_activations

sessions
projects
agents

projections

model_invocations
```

SQLite full-text search can initially provide lexical retrieval.

Graph traversal can initially operate over ordinary relational tables.

Vector storage may use an SQLite extension or another embedded index.

The important invariant is:

> Vectors are rebuildable indexes, not authoritative memory.

---

## 32. Provenance

Every derived memory must retain evidence.

Example:

```text
Memory:
"The project uses SQLite."

derived from:
├── event 183
├── event 417
└── decision 92
```

This allows:

- verification;
- debugging;
- correction;
- temporal reasoning;
- contradiction resolution;
- deletion propagation;
- memory rebuilding.

Derived knowledge must remain auditable.

---

## 33. Contradictions

Contradictions should coexist until resolved.

Example:

```text
Assertion A:
Framework(Project, React)

Assertion B:
Framework(Project, Svelte)
```

The reconciliation system asks:

```text
Did the framework change?

Are these separate components?

Is one source stale?

Is one assertion incorrect?

Does temporal ordering resolve the conflict?
```

Possible result:

```text
React:
valid T1 → T2

Svelte:
valid T2 → present
```

The system should not blindly use "latest text wins."

---

## 34. Temporal Semantics

Memory must distinguish:

```text
event time

observation time

knowledge time

validity interval
```

This is required for understanding changing state.

A memory may have been observed today while describing a fact that was true last year.

Those concepts must remain distinct.

---

## 35. Retrieval as Activation

Memory retrieval should not be implemented as:

```text
vectorSearch(query)
```

Instead, a request first becomes a memory activation plan.

Example:

```text
Intent:
continue project

Activate:
- current project state
- active goals
- unresolved decisions
- recent relevant episode
- architecture constraints
- relevant preferences
- relevant procedures

Suppress:
- obsolete project state
- unrelated historical detail
```

Retrieval can then combine:

```text
vector similarity
lexical matching
graph traversal
temporal proximity
entity relationships
causal relationships
structural matching
procedural applicability
```

---

## 36. Candidate Scoring

Candidate activation may consider:

```text
semantic relevance
lexical relevance
graph distance
temporal relevance
causal proximity
importance
confidence
novelty
past utility
access frequency
task compatibility
token cost
contradictions
current validity
```

An approximate conceptual score might be:

```text
activation =
    relevance
  + graph-proximity
  + task-utility
  + importance
  + recency
  + learned-usefulness
  - token-cost
  - staleness
  - contradiction-risk
```

The exact scoring mechanism should remain learnable and replaceable.

---

## 37. Associative Activation

Activation should spread through graph relationships.

```text
DarkFactory
    ↓
Agent Harness
    ↓
Memory Runtime
    ↓
Context Compiler
```

Activation strength decays with graph distance.

Conceptually:

[
A(m)=R(m)+sum_i A(i)w_{i,m}lambda^{d(i,m)}
]

where:

- `R(m)` is direct relevance;
- `w` is relationship strength;
- `d` is graph distance;
- `λ` controls decay.

This creates associative recall without blindly retrieving the entire graph.

---

## 38. Working Memory

Four concepts must remain distinct.

```text
Long-term memory
    persistent durable state

Working memory
    currently activated memories

Scratch state
    transient computation

Model context
    serialized projection sent to one inference
```

The context window is therefore not memory itself.

It is a generated view of working memory.

---

## 39. Context Compilation

Retrieved memories should not simply be dumped into the prompt.

A context compiler produces a task-specific projection.

Example:

```text
<memory-context>

CURRENT
- Project: universal agent memory
- Objective: universal persistent memory layer
- Current architecture: CLI-first local runtime
- Model infrastructure: external LiteLLM binding

DECISIONS
- Automatic interception occurs before inference
- MCP is explicit memory access
- Native hooks enrich but do not own ingestion
- SQLite is initially authoritative storage

RELEVANT
- Every derived memory retains provenance
- Memory projections cannot recursively become evidence
- Embeddings are indexes rather than canonical memory

RECENT
- Universal Claude/OpenCode/agent support requested
- Classifier and embedding models should be routed externally

AVAILABLE
- 14 additional architecture memories
- 6 implementation memories
- 3 related historical decisions

</memory-context>
```

The agent can explicitly expand details through MCP or CLI.

---

## 40. Hierarchical Resolution

Memories should support several levels of abstraction.

```text
event
 ↓
micro-summary
 ↓
episode
 ↓
episode-summary
 ↓
project-phase
 ↓
project-model
 ↓
general concept
```

Retrieval should initially provide the cheapest sufficient representation.

Further detail can be expanded on demand.

```text
Project changed architecture
        ↓
expand
        ↓
Architecture redesign episode
        ↓
expand
        ↓
Specific decision
        ↓
expand
        ↓
Original source events
```

This keeps context efficient while preserving complete historical depth.

---

## 41. Consolidation

Consolidation converts accumulated events into better memory.

It may run:

- periodically;
- during idle time;
- manually;
- after session completion;
- after threshold events.

Possible operations:

```text
cluster related memories
merge duplicates
resolve entities
detect contradictions
generalize repeated observations
extract concepts
extract procedures
update project state
create episode summaries
strengthen useful relationships
weaken irrelevant activation paths
compress old detail
```

Consolidation should normally operate asynchronously relative to ordinary inference requests.

---

## 42. Forgetting

Forgetting has two distinct meanings.

### Accessibility decay

The information still exists historically but becomes less likely to activate.

### Destructive forgetting

The underlying information is intentionally removed because of privacy, explicit user action, policy, or storage management.

These must not be conflated.

Different memory classes should decay differently.

```text
random conversation detail       fast

temporary task state             medium

project decisions                slow

stable preference                very slow

validated procedure              very slow

source provenance                effectively permanent
                                 unless explicitly removed
```

---

## 43. Memory Utility Learning

The system should track whether retrieved memories were useful.

```text
memory activated
      ↓
included in working context
      ↓
agent performs task
      ↓
result observed
      ↓
success / failure / correction
      ↓
update memory utility
```

This allows retrieval policy to improve over time.

The long-term objective is for the system to learn:

> In this kind of state, which memories help?

rather than relying indefinitely on fixed heuristics.

---

## 44. Worker-Specific Memory Views

Different workers need different projections.

```text
Coding Worker
├── repository state
├── architecture decisions
├── source structure
├── recent patches
├── coding conventions
└── relevant procedures

Vision Worker
├── visual episodes
├── object identities
├── spatial relationships
└── visual concepts

Language Worker
├── discourse history
├── semantic assertions
├── user preferences
└── relevant concepts
```

There is one memory substrate.

Workers receive different views.

---

## 45. Internal Reasoning

Transient chain-of-thought-style internal computation should not automatically become durable memory.

The memory system should prefer storing durable outcomes:

```text
decision
observation
conclusion
hypothesis worth tracking
failure
learned procedure
goal change
state transition
```

rather than arbitrary temporary reasoning tokens.

---

## 46. World Model

Over time, semantic and relational memory should form a persistent world model.

```text
WORLD MODEL

├── self
│   ├── capabilities
│   ├── workers
│   ├── models
│   ├── tools
│   └── procedures
│
├── user
│   ├── preferences
│   ├── projects
│   ├── goals
│   └── relationships
│
├── environment
│   ├── files
│   ├── repositories
│   ├── machines
│   ├── services
│   └── applications
│
└── concepts
    ├── entities
    ├── relationships
    ├── rules
    ├── expectations
    └── causal models
```

At this point memory is no longer something the agent periodically searches.

It becomes the agent's persistent internal state.

---

## 47. Initial Repository Structure

A possible initial monorepo structure:

```text
memory/
├── packages/
│   ├── core/
│   │   ├── memory/
│   │   ├── events/
│   │   ├── entities/
│   │   ├── graph/
│   │   ├── retrieval/
│   │   ├── context/
│   │   └── consolidation/
│   │
│   ├── runtime/
│   │   ├── daemon/
│   │   ├── api/
│   │   └── sessions/
│   │
│   ├── storage/
│   │   ├── sqlite/
│   │   ├── vectors/
│   │   └── migrations/
│   │
│   ├── models/
│   │   ├── interfaces/
│   │   └── litellm/
│   │
│   ├── cli/
│   │
│   ├── sdk/
│   │
│   ├── proxy/
│   │   ├── openai/
│   │   ├── anthropic/
│   │   └── generic/
│   │
│   ├── mcp/
│   │
│   └── adapters/
│       ├── claude/
│       ├── opencode/
│       ├── codex/
│       ├── agents/
│       └── generic/
│
├── apps/
│   └── mem/
│
├── docs/
│
└── README.md
```

This structure can be simplified during implementation, but the dependency direction should remain clear.

---

## 48. Dependency Direction

The desired dependency graph is:

```text
core
↑
storage
↑
runtime
↑
├── cli
├── mcp
├── proxy
├── sdk
└── adapters
```

Model bindings depend on core capability interfaces.

```text
core model interfaces
        ↑
     models/
        ↑
 LiteLLM adapter
```

Nothing in `core` should depend on Claude, OpenCode, MCP, or LiteLLM.

---

## 49. Initial Implementation Scope

The first functional version does not need the complete future ontology.

It should establish the correct architecture.

### Phase 1 — Core runtime

Implement:

```text
event ledger
SQLite storage
sessions
context item deduplication
basic memory records
entities
evidence/provenance
CLI
local daemon
```

### Phase 2 — Model processing

Implement:

```text
LiteLLM binding
classification
structured extraction
embeddings
basic reranking
```

### Phase 3 — Retrieval

Implement:

```text
FTS retrieval
vector retrieval
entity relationships
temporal filtering
combined scoring
context compilation
```

### Phase 4 — Universal interception

Implement:

```text
OpenAI-compatible proxy
Anthropic-compatible proxy
projection tagging
automatic memory injection
```

### Phase 5 — Integrations

Implement:

```text
Claude adapter
OpenCode adapter
Codex adapter
generic adapter
```

### Phase 6 — MCP

Implement:

```text
memory_search
memory_recall
memory_remember
memory_forget
memory_inspect
memory_context
memory_entity
memory_history
```

### Phase 7 — Consolidation

Implement:

```text
episodes
contradiction detection
supersession
project state
preferences
procedures
background consolidation
```

### Phase 8 — Learned memory

Implement:

```text
activation feedback
utility scoring
adaptive retrieval
expectations
procedure induction
predictive memory
```

---

## 50. Initial Hot-Path Optimization

Memory processing occurs before inference, so latency matters.

The synchronous hot path should initially prioritize:

```text
context diff
event append
fast classification
fast extraction where necessary
embedding only new content
retrieval
reranking
context compilation
```

Expensive work should be deferred whenever possible:

```text
large-scale clustering
episode rewriting
generalization
historical contradiction scanning
procedure induction
graph optimization
re-embedding
```

The memory system should improve inference without turning every model call into another large agent workflow.

---

## 51. Failure Behaviour

Memory must not become a single point of failure for the underlying agent.

The desired principle is:

```text
memory enhancement failure
≠
agent inference failure
```

Where safe, failure should degrade to:

```text
record error
forward original request
skip injection
continue agent execution
```

Exceptions include corruption or situations where silently continuing would compromise explicit user expectations.

The proxy therefore needs strong observability and failure isolation.

---

## 52. Observability

The CLI should make the system inspectable.

Examples:

```bash
mem status

mem doctor

mem events --tail

mem trace request_01H...

mem inspect mem_01H...

mem explain-recall mem_01H...

mem projections

mem models status
```

For any recalled memory, it should eventually be possible to answer:

```text
Why was this memory selected?

Where did it come from?

When was it learned?

What evidence supports it?

What other memories contradict it?

Why was this abstraction level used?

When was it last useful?
```

Memory should never become an opaque hidden database.

---

## 53. Privacy and Control

Every memory should support policy metadata.

At minimum:

```text
retention
visibility
scope
source
deletion state
```

Future policies may include:

```text
user-only
project-only
workspace-only
agent-specific
shared
temporary
non-consolidatable
non-embeddable
sensitive
```

Explicit memory deletion must propagate through derived representations.

For example:

```text
source event deleted
      ↓
derived assertion invalidated
      ↓
embedding removed
      ↓
episode regenerated
      ↓
graph relationship updated
```

---

## 54. Architectural Invariants

The following are long-term system invariants.

1. **The event ledger is the historical source of truth.**
2. **Memory objects are typed structured state, not arbitrary text chunks.**
3. **Every derived memory retains provenance.**
4. **Time and changing truth are first-class concepts.**
5. **Embeddings are representations and indexes, never canonical memory.**
6. **Graph, vector, lexical, temporal, symbolic, and structural retrieval may coexist.**
7. **Automatic memory interception happens before model inference.**
8. **Native agent hooks enrich the event stream but do not own memory.**
9. **MCP provides explicit memory access but is not responsible for automatic interception.**
10. **The CLI is a first-class canonical interface for both humans and agents.**
11. **All integrations target one shared memory runtime.**
12. **LiteLLM is an external model capability binding, not part of the memory substrate.**
13. **Repeated context transmission must not create repeated memories.**
14. **Memory projections must not recursively become source evidence.**
15. **Context is compiled from activated memory rather than directly retrieved and dumped.**
16. **Working memory, long-term memory, scratch state, and model context remain distinct.**
17. **Contradictions are preserved until they can be reconciled.**
18. **Consolidation may create abstractions but may not sever them from evidence.**
19. **Explicit deletion and ordinary accessibility decay are separate operations.**
20. **The architecture must remain agent-runtime-independent.**

---

## 55. End-State Architecture

The complete conceptual architecture is:

```text
                               USER
                                 │
                                 ▼
 ┌──────────────────────────────────────────────────────────────┐
 │                       AGENT RUNTIME                          │
 │                                                              │
 │ Claude │ Codex │ OpenCode │ Agents │ arbitrary future agent │
 └───────┬──────────────────────────────────────┬───────────────┘
         │                                      │
         │ native semantic hooks                │ model request
         ▼                                      ▼
 ┌───────────────────┐                ┌─────────────────────────┐
 │ Adapter / Plugin  │                │      Memory Proxy       │
 │                   │                │                         │
 │ richer events     │                │ universal context gate  │
 └─────────┬─────────┘                └────────────┬────────────┘
           │                                      │
           └────────────────┬─────────────────────┘
                            ▼
                  ┌────────────────────┐
                  │   Memory Runtime   │
                  │                    │
                  │ event ledger       │
                  │ semantic memory    │
                  │ episodic memory    │
                  │ entity graph       │
                  │ project state      │
                  │ procedures         │
                  │ expectations       │
                  │ retrieval          │
                  │ context compiler   │
                  │ consolidation      │
                  └──────┬─────────────┘
                         │
             ┌───────────┼────────────┐
             ▼           ▼            ▼
          SQLite      indexes       Models
                                      │
                                      ▼
                                   LiteLLM
                                      │
                      ┌───────────────┼───────────────┐
                      ▼               ▼               ▼
                 classifier       embedder        reranker
                      │               │               │
                      └───────┬───────┴──────┬────────┘
                              ▼              ▼
                          extractor       reasoner
                              │              │
                              └──────┬───────┘
                                     ▼
                                consolidator


        ┌────────────────┐       ┌────────────────┐
        │      CLI       │       │      MCP       │
        │                │       │                │
        │ human + agent  │       │ explicit agent │
        │ control        │       │ memory access  │
        └───────┬────────┘       └───────┬────────┘
                │                        │
                └────────────┬───────────┘
                             ▼
                       Memory Runtime
```

The result is not a memory feature attached to one agent.

It is a reusable, persistent memory substrate that arbitrary agents can inherit.

An agent can encounter the system through a native plugin, a model proxy, MCP, the CLI, or an SDK and still operate against the same underlying memory state.

The first implementation can remain relatively small:

```text
SQLite
+
local daemon
+
CLI
+
LiteLLM model bindings
+
OpenAI/Anthropic inference proxy
+
MCP
+
Claude/OpenCode adapters
```

while preserving an architecture capable of evolving toward structured episodic memory, procedural learning, graph cognition, adaptive retrieval, consolidation, predictive memory, and eventually a persistent world model.
