# Graph kernel

Host task journals, ownership, evidence validation, waits and unknown-write
blocking remain authoritative. A derived graph cannot grant control, validate a
business result or authorize a relation to an inaccessible reference.

The graph implementation extracts the pinned ARTEX algorithms identified in
`native/graph-core/extraction.json`. Database services, shared task assets and
model-declared goal completion are excluded. Apache-2.0 reuse authorization has
been confirmed; the authorization original remains private.

Graph projections are disposable. Loss of a projection does not change task
facts or replay page commands. Local task data and qualification receipts remain
outside the public source tree and package.

## Derived graph and cold digests

The Go module is standard-library-only. It replays sanitized journal events and
retains opaque public IDs. Compression alone reverses `attempts` and `records`
into parent-to-child adjacency; public edges keep their original direction.

A finalized click, type, select, check or file-selection receipt advances one
round. Reads do not advance rounds. Defaults require six continuously cold
rounds and two members. Unfinished or unknown actions, current proof references,
goals, criteria and technical assets are not folded. Blocks never cross runs.

Digests list members, anchors, outcomes and source sequences. Their references
include the projection identity and content signature. Recomputing replaces the
active coverage set; originals remain available. An old digest reference is
rejected after the input changes. No generated summary establishes business
success, and no model call is used for compression.

## Worker ownership

The Host consumes its mounted subprocess service through a small structural
TypeScript interface matching the supported API. Workers are lazy, task-owned
and replaced on run changes. IPC v2 uses a four-byte big-endian length and UTF-8
JSON, with request, generation, RunScope, journal position and input hash checks.

Limits are validated plugin settings: four workers, 60-second idle lifetime,
five-second request budget, 8 MiB frames, 16 KiB stderr and one-second termination
grace by default. Startup and waiting consume the request budget. A failed RPC
is not replayed. Unloading joins the managed process ranges before releasing the
provider. Raw stderr and executable paths never enter tool failures.

Only Windows x64 has a packaged production helper. Other platforms report an
unavailable graph while loading the plugin and keeping safe Host operations.
The test-only process provider and host-platform helper are not runtime fallbacks.

## Tool output and failure handling

Only `browser_observe` with `view: "task"` requests a graph. Panel polls carry
Host state without waiting for graph computation, so queued page command budgets
are not consumed by an unrelated graph read. Existing task detail references
also serve graph and digest details. There is no seventh tool or new route.

The Host verifies every returned reference against the sanitized input and
replaces criteria, waits, permissions, log health and business verdicts with
current Host facts. `active_context.graph` records availability and the exact
projection ID. Unavailable projections do not block independent page operations,
user waits, safe original reads or permission withdrawal. Unknown writes remain
blocked regardless of graph availability. Large views include detail references
and an explicit truncation flag; mandatory safety state remains visible.

Acquisition is serialized within each task. A worker whose exit is not yet
confirmed still occupies capacity, but does not hold another task's acquisition
queue. Read deadlines include acquisition and detail preparation. An expired
read returns without waiting for cleanup; the registry retains the process and
joins its managed range during retirement or disposal. A timed-out replacement
cannot start a helper later, and retiring a predecessor cannot discard ownership
of its replacement.

Retirement immediately detaches RPC listeners and clears derived caches. Stream
draining and error handling remain owned until the managed range confirms exit.
Failed exit observation retains capacity and reports `cleanup_failed`; another
retirement attempt can confirm a later exit. Termination grace controls process
termination escalation, not the deadline for exit observation.

Task cancellation and revision return their durable journal result without
waiting for retirement. `active_context.graph.cleanup` separately reports
pending or failed process cleanup. Disposal still joins every owned range and
reports failure if exit cannot be confirmed.

Replay updates causal adjacency and live-intent ancestor sets incrementally.
Only nodes affected by a journal transition update their cold stamps. Final
grouping shares node/version indexes across digests. Projection identity depends
on the complete sanitized input, including current Host document identity, and
does not depend on the view's character budget. View and detail RPCs share the
prepared projection through a serial queue bounded by `queueLimit`; the original
request deadline includes queueing. An expired queued read cannot dispatch later.

## Complete detail continuation

Internal detail replies carry consecutive base64 byte chunks. Every chunk echoes
the request binding; its full encoded envelope fits `graphMaxFrameBytes`. The
Host checks offsets, total length, progress, encoding and completion, then decodes
strict UTF-8 and validates the entire JSON graph before returning model-visible
text. `graphMaxDetailBytes` caps the complete detail on both sides: default 32 MiB,
range 64 KiB–256 MiB, and at least `graphMaxFrameBytes`. Capacity errors are
reported separately from stale references. Each worker caches one complete
validated detail for the current input.

The outer tool keeps character-based `offset`, `text`, `totalChars` and `complete`.
Graph and digest details return `projectionId`; nonzero offsets must provide that
same identity. The identity hashes the tuple `["task-graph", "3", inputHash]`; a changed kernel or input requires reading again from offset zero.
Offsets are nonnegative safe integers and cannot exceed the actual text length.

Page asset summaries include their safe `documentToken`. Only the Host adds
`validity`, after checking the current authorized document. Other asset kinds
carry neither field. Revocation and navigation invalidate that live comparison.

Read-only and unhealthy histories refuse derived detail reads before graph input
construction. Host-owned goals, criteria, resource snapshots and permitted
original assets remain readable. An unavailable graph does not reinterpret old
journal semantics.

Successful packaged-binary verification is cached for one plugin instance.
New workers check executable and manifest file identities without rereading their
bytes. Replacing either artifact requires a paired plugin reload; failed initial
verification is not cached. No file watcher or runtime downloader is installed.

Kernel v3 gives each current code-proof edge a criterion-specific ID. Host validation simulates replay-order endpoint creation, including skipped forward references, and checks complete edge identities. A recorded `proves` relation alone does not establish a code-verified criterion.
