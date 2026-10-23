# Graph kernel

Current runtime: Browser Flow v4, RPC v2, kernel v5; generation 1 is preserved and new exploration uses generation 2.

Host task journals, ownership, evidence validation, waits and unknown-write
blocking remain authoritative. A derived graph cannot grant control, validate a
business result or authorize a relation to an inaccessible reference.

The graph implementation extracts the pinned ARTEX algorithms identified in
`native/graph-core/extraction.json`. Database services, shared task assets and
Go-owned goal completion are excluded. Generation-2 task completion belongs to the Host, using Agent interpretation and original-backed checks. Apache-2.0 reuse authorization has
been confirmed; the authorization original remains private.

Graph projections are disposable. Loss of a projection does not change task
facts or replay page commands. Local task data and qualification receipts remain
outside the public source tree and package.

## Derived graph and cold digests

The Go module is standard-library-only. It replays sanitized journal events and
retains opaque public IDs. Compression alone reverses `attempts` and `records`
into parent-to-child adjacency; public edges keep their original direction.

For generation 1, a finalized click, type, select, check or file-selection receipt advances one round. Generation 2 advances on each planner-to-worker claim instead; a semantic intent can have several browser attempts. The graph includes goal/intent/fact/hint nodes, separate attempts and source-sequenced ARTEX relations. Reads do not advance rounds. Defaults require six continuously cold
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

The idle timer starts as soon as a worker is owned, including before its first RPC. Each RPC clears and rearms it. A caller that expires during acquisition cannot leave an unbounded idle process; retirement retains its capacity until managed exit is confirmed.

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

Display budgets must be positive safe integers at view entry; invalid values fail before worker acquisition. Internal RPCs reject negative display budgets as `invalid_budget` and reserve zero for handshake, detail and projection preparation. This does not change the request's time budget.

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
same identity. Kernel v4 hashes the tuple `["task-graph", "4", inputHash]`; a changed kernel or input requires reading again from offset zero.
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

## Kernel v4: task-local resource and exploration views

The delivery boundary is M1–M5: resource identity, operation provenance, two
queryable views, current-criteria coverage, local/package checks and Windows
Host/Desktop checks. Cross-task sharing, a graph UI (M6, P2), layout and helper
optimizations (M7, P3) are outside this stage. No new database, tool, route or
website automation engine is introduced. ARTEX and Harness source are read-only.

| Work | Priority | Failure if omitted | Minimum acceptance |
| --- | --- | --- | --- |
| M1 identity, provenance and compatibility contract | P0 | Grouping could be mistaken for authority or proof | Reject foreign runs, logical-resource proof substitution and invented causality |
| M2 immutable snapshots and resource identity | P1 | Repeated observations cannot be grouped without losing evidence identity | Document replacement, changed file bytes, different sources and old references remain distinguishable |
| M3 operation associations | P1 | Nodes lack a trustworthy operation context | Durable context links precede dispatch; failed recording cannot replay a write |
| M4 queries and coverage | P1 | The Agent cannot use either graph or inspect unverified conditions | Both views, reverse trace, bounded continuation and Host-only coverage |
| M5a local/package validation | P1 throughout | Correct source may ship unusable or break older data | Required regressions, build, types and task-free installed-package load |
| M5b Windows Host/Desktop validation | P1 | A test process provider cannot establish production wiring | Managed Windows helper and two independent normal Agent Sessions on one candidate |

M1 precedes M2/M3, then M4 and final M5. Missing validation blocks only its
dependent acceptance; optional tooling does not block independent work. A local
pass is not a Windows/Desktop pass or website business acceptance.

### Identity and authority

`asset-…` remains an immutable observation/snapshot ID. Optional
`asset.data.resourceIdentity` version 1 contains only an opaque key, identity
basis and snapshot kind. A Host-validated physical guest identity (guest lease
and partition) plus `documentToken` groups page observations. Panel remounts,
transport generations, control-grant IDs, URL and redacted URL are not grouping keys.
Reload/navigation to a new document token creates a distinct resource. A file
uses the normalized source path already checked by file preparation. Its key
is scoped to the complete RunScope and type; the original path is not sent to
Go. Each preparation keeps its own snapshot and content digest. Identical
content at different sources remains distinct.

The derived `resource-…` identity includes every RunScope field and asset kind.
Unit checks, results and evidence remain independent records. A page/file with
missing or unsupported identity metadata has an independent resource with
`reliable_identity_unavailable`; no historical file is rewritten to guess an
identity. Old asset references continue to read the same recorded bytes.
Resource IDs cannot authorize control, become journal edge endpoints or replace
the exact asset IDs required by a validator.

### Relations and reads

Both views replay the same generation-1 journal. The asset view contains
resources, snapshots and asset-to-asset relations. The exploration view contains
goals, current criteria, intents, receipts and cold digests. Both carry identical
cross-plane anchors with the original edge ID, direction, endpoints, relation,
source sequence, event run and both endpoint runs. Existing historical relations
are displayed as history; new relations reject either endpoint outside the
current run. A historical `proves` edge does not establish current coverage.

An action's `attempt -> page` `observed_on` edge (named `intent` in generation 1) is durable before dispatch. With
no observation of that guest/document, Host records a `contextOnly` page
snapshot. It is not a page observation and cannot pass the navigation validator.
File preparation binds `attempt -> file` with `yields`; selection binds
`attempt -> file` with `selected_from`. Trusted import verification preserves its
exact result/proof references. No adjacent event is treated as causal. Reverse
trace follows explicit edges in either direction and does not expand from a
shared goal to unrelated actions. All associations are descriptive; only Host
validators decide evidence validity.

Ordinary observations carry Host-owned `contextOnly:false` in both their result
and snapshot. A guest-supplied marker cannot turn them into context snapshots.
Host-created context-only snapshots remain ineligible for navigation proof;
historical records keep their original bytes.

Use the existing `browser_observe` with `view:"task"`:

- `ref:"graph"` retains the original combined view.
- `ref:"graph:assets"` returns resources, snapshots, relations and anchors.
- `ref:"graph:exploration"` returns exploration nodes, relations, digests and anchors.
- `ref:"resource-…"` returns snapshots, connected relations/anchors,
  exploration references and evidence references. A criterion detail supplies
  its currently validated `proofRefs` and the exploration view entrypoint.
- `ref:"coverage"` returns Host-verified coverage and reasons per condition.
- `ref:"definition:<path>"` reads an exact whitelisted definition snapshot file,
  including files named `coverage` or `graph`. Summaries advertise this reference
  in instruction `ref` fields and the `resources` array. Nonconflicting old bare
  paths remain aliases; system names and generated-reference prefixes retain
  their system meaning. No snapshot or journal migration is required.

Summaries provide counts and detail references. All derived continuations
require the returned `projectionId` at nonzero offset; changed input/kernel
requires restarting at zero. Coverage has a Host-only identity over the journal
position and refreshed coverage facts, so it works without Go and expires when
evidence validity changes. Large details use the existing UTF-8 chunk transfer,
character continuation and capacity limits.

### Coverage and upgrade

Coverage includes every current declared condition and every existing trusted
adapter condition, distinguished by condition ID. Only a current-run criterion
whose original evidence passes the existing Host validator contributes to
`verified`. Free text reports `no_validator`. `total`, `verified`, `unverified`
and `ratio` never change the business verdict or lifecycle. Empty total returns
`ratio:null`; two free-text conditions plus one verified condition yield 1/3.
Task tool reads recheck originals. Panel polling only displays the last Host
facts and does not start a worker or scan originals.

Verdict, criteria and coverage reuse the same Host facts within each read phase.
Details still recompute after evidence refresh. `evidence_unavailable` identifies
an unavailable proof selected by the current condition's last judgment; unrelated
evidence issues stay listed separately. With no eligible current proof, coverage
reports `no_valid_current_run_proof`. Diagnostic candidates never establish a
verified condition or a graph proof edge.

Resource descriptors are cached by immutable journal event and complete run;
this does not cache evidence judgments or projection freshness. Host identity
bytes remain stable. Metadata-free direct IPC uses its separate Go JSON fallback
encoding, including short `\b` and `\f` escapes.

Upgrade the Host, generated runtime and native helper as one paired package:
kernel version 5 and Browser Flow protocol 4 are required by the manifest,
handshake and validation. Framed RPC 2 and `structural-v1` cold rules remain
unchanged. Older workers and continuation identities are refused. Generation 1
keeps its original journal bytes and operation-based semantics; new exploration
tasks use generation 2, semantic goals/intents/facts/hints and planning rounds.
Unversioned/damaged histories keep their read-only behavior and do not start
derived workers; healthy generation-1 records retain their capabilities.
See [the v4 upgrade guide](upgrade-v4.md) for the paired rollout and compatibility
rules. The earlier task-local dual-graph delivery used kernel 4 and protocol 3;
those versions describe that historical candidate, not the current runtime.
