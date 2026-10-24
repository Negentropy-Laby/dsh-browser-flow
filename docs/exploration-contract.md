# Generic exploration contract

Priority: P0 (G1). Browser Flow v4, journal generation 2, kernel v5, RPC v2.

The ARTEX reference separates goals, semantic intents, facts, hints and assets.
A semantic intent can contain several browser attempts. The Host owns the journal,
phase, evidence checks and completion; Go derives graphs and structural-v1 digests.
One Agent alternates planner and worker phases, with at most one running intent.

Relations point origin fact → goal (spawns), fact → intent (derived_from),
intent → fact (yields), fact → goal (proves). Resource anchors and exact evidence
snapshots are different references. Origin facts, inferred facts, hints and action
receipts cannot prove goals. A fact's business interpretation is Agent-authored;
Host checks never become an independent business verdict.

Generation 1 tasks keep their original format and behavior. New generic tasks
use workflowRef exploration and generation 2. No implicit migration, URL-based
resource identity, cross-run proof, scope widening or page-action replay is allowed.
Existing six tools carry the new semantic operations. New observations override
all Host-owned flags and identities; source content is untrusted data.

Completion requires every mandatory original goal and condition, current evidence,
passing source-backed checks, and no pending write, unknown outcome or human wait.
Control is withdrawn before durable completion; persistence failure cannot report
success. Subsequent missing evidence is reported without changing history or
repeating business actions. Asset coverage is a reference metric, not goal proof.

The implementation contains no new site routes, business field names, recipes or
success labels. No new database, execution engine, dependencies or tools are needed.
P2/P3 work never blocks the P0/P1 delivery. Live business acceptance is separate
from technical and synthetic acceptance and uses the same candidate.

Structured checks allow 32 atoms and 64 distinct original sources. A fact may
reference 64 original snapshots and 32 checks/resources. Commands have a 100,000
character limit; their expanded journal payload has a 200,000 character and
256-edge limit. These aggregate limits are checked before evidence I/O or
writes. Oversized batches are rejected atomically with their measured use; split
or shorten them and use new request IDs with the latest contextVersion.

File controls use the Host's `fileMode` capability (`generic`, `legacy_import`,
`none`), not the workflow name. `view:file` reads originals only in generic
exploration tasks; legacy tasks can read snapshot metadata using `view:task`.
New `set_file` envelopes name their mode; compatible old envelopes are normalized
at the shared protocol boundary. Conflicting mode metadata is refused.

Origin facts have a separate `originRef` and do not count as recorded findings.
Goal lists, overview and node details use the same proof status. When a node query
is too large, its summary and relation counts remain visible, and `continuation`
contains the exact `ref`, `offset` and `projectionId` for the task detail channel.
Page originals are persisted only when the Host observation call explicitly
requests it; a context snapshot does not carry an observation original.

Host caches contain derived indices, parsed source values, serialized file views
and assertion calculations. The journal index advances by run, sequence and tail
hash. The Store's derived-value LRU has at most 32 entries and a total payload
budget of `graphMaxDetailBytes`; oversized values remain readable without caching.
Revise clears that task's entries; closing the Store clears all entries.
A cache hit never establishes that an original is still available: authoritative
reads continue checking full bytes. A new structured check reads each source at
initial evaluation, immediately before persistence and before publication, and
reads back the written proof. File continuation reuses parsing and serialization
while rechecking source contents on every request.
