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
