# Local tasks and infrastructure

`/tasks/` is ignored at the repository root and excluded from the package's explicit file whitelist. Keep local definitions, instructions, input files and detailed evidence there. Infrastructure, trusted site safety policies and synthetic fixtures stay tracked outside it. Build and cleanup never delete local tasks.

Set `localTasksDir` in a private profile when a separate task directory is needed. Without that setting it defaults to `profileContext.home/browser-flow/tasks`; neither CWD nor the plugin installation directory supplies a storage location. Missing directories are normal at load. Task creation initializes runtime storage lazily. Resource references must stay within a definition and may not traverse links. Never commit resolved user directories or profile data.

A definition declares `schemaVersion: 1`, an `id`, `version`, a supported trusted `adapter`, `adapterVersion: 1`, exact `origins`, a `resources` whitelist and `workflows`. Each workflow declares `id`, explicit `skill`, `description`, `instructions` and `resources` references, and a `stopBoundary`. Definitions cannot execute scripts or change trusted security checks. An invalid definition is unavailable without preventing other definitions or the six tools from loading. There is no bundled fallback definition.

Optional skills only direct the Agent to `browser_observe(view:"task")`. The bound instance snapshot supplies the actual instructions in a normal, logged tool result. Absence of the skills service does not disable the tools.

## Definition updates

Updating local resources does not update a running task. New task instances take an immutable snapshot; prior instances keep their own version. Reinstalling the infrastructure package does not distribute task definitions or erase them. Copy local definitions separately when intentionally preparing a new installation. Host and Client must be reloaded together after protocol changes.

## Durable attempts and recovery

The profile store acquires one cross-process writer lease in a verified local OS/host namespace. Session ownership is persisted separately from current control. `basic_law_index/events.jsonl` is append-only, sequenced and hash-linked; each complete record is explicitly synchronized before dependent work. File preparation/confirmation and every page action record an attempt before processing inputs or queueing a command. The Host's original monotonic budget includes that work; remaining time is recomputed before delivery. The Client continues to deduct its own waiting and execution time.

Every async resumption rechecks the exact Agent, task/run, lease, document, epoch, panel and generation. Revocation clears control before any journal operation. Shutdown stops admission, revokes, drains admitted operations and their final records, then releases storage. A task-log error cannot hold the page grant open. A readable existing journal can be opened without a writer for safe task inspection; it cannot authorize new writes.

Recovery preserves valid history and damaged original bytes; it never truncates evidence or sends a command. Incomplete attempts and damaged tails block writes. Unknown results remain blocked through new runs, revisions, handoff and restart. Ending a task records user lifecycle and does not assert that its business criteria passed.

## Five task modules

- `basic_law_index` owns the append-only event history. Summary entries name sequence and hash; failures never rewrite old entries.
- `procedural_law_index` projects the user goal, constraints and criteria, model action intents, receipts and waiting conditions. User criteria remain unverified until a trusted validator supplies supporting facts.
- `technical_law_index` projects task-local page, file, identity-check, result and evidence assets. Equal names or digests in different tasks do not merge instances.
- `knowledge_graph` relates owned goals, criteria, intents, receipts and assets. Both endpoints must belong to the opened task. It has no global private-asset lookup.
- `active_context` supplies a bounded summary with task/run identity, context version and source sequences. Truncation is explicit; the summary cannot certify a business result.

Use `browser_observe(view:"task", ref, offset)` to read a task-local asset, `goal`, or a listed snapshot resource in bounded continuations. Missing and foreign references share the same refusal. Instructions marked incomplete must be read through their listed references before following them. A normal task view and its detailed continuations enter the Session as tool results; no hidden model prompt is injected. Projections are rebuilt from the owning journal, without an additional graph database or background worker.

## Site adapters

Trusted adapters define their supported workflow IDs, action restrictions and stop conditions in code. Local definitions cannot add executable policies or weaken those checks. A supported import policy can permit a confirmed business kind, bounded result actions and one file assignment. Generic adapters do not inherit another site's endpoints, upload permission or success validator. Task-specific menu instructions and acceptance records remain private.

Every authorized guest is checked against the task's exact allowed origins. The Host binds the task site policy into commands and the Client checks it against the user's grant before guest entry. Page observations, prepared file summaries and strict import results become task-local assets; private raw response/input bytes stay in that task's evidence directory. A code result is linked to the corresponding file asset. Current business verdicts require this exact run; previous-run results remain historical evidence. Neither navigation entry nor a click receipt completes arbitrary user criteria.

The Host queue also refuses direct `act` entry without the task's current durable attempt. This prevents internal consumers from bypassing the write journal. Recovery validates revision ownership before reducing it; an inconsistent revision cannot replace a task's Session/profile/task identity.

New storage uses format v1 for manifests, ownership and every journal record. Append and recovery share the closed event parser. Unversioned predecessors remain byte-preserved, read-only history; unknown or invalid records expose a storage issue and cannot enable writes. A new Session is required for new work.

Trusted adapters add stable, task-scoped criteria. User text remains unverified unless a supported code predicate applies. A business label is not a proof: navigation rechecks its owned page observation; import rechecks the input snapshot, once-only acknowledged dispatch, identity, complete response and fresh table through the existing strict validators. Originals and their digests stay private. Missing, changed, foreign or previous-run evidence cannot certify a current criterion, including after recovery.

The graph links attempts, receipts, results, originals and criteria. Read `ref:"criteria"` or `ref:"graph"` through the normal task view when the summary is truncated. IDs in the summary, graph and details are identical. Evidence details disclose availability and digests rather than private artifact paths or bytes.

## User dependencies

An Agent can call `browser_act` with `action:"await_user"` and `wait:{kind,reason,resumeCondition}`. Kinds are login, page_authorization, file_input, file_confirmation, real_table, real_batch and other_user_input. The Host records a user-owned model declaration and returns its wait ID after synchronization; no page target, grant, guest command or sequence is involved. Identical requests return the existing wait. Pending writes, unknown results, legacy read-only history and unavailable logs cannot register another wait.

A pending user dependency prevents page writes. Safe page/task reads, permission withdrawal and human file preparation remain available. Use the panel to provide input and resume the exact current wait. Page/file dependencies require a newly supplied capability after the request and its current Host-verified binding; a text acknowledgement cannot substitute for it. Other kinds require explicit new human input, recorded as user-declared rather than code-verified. Resume grants no control and proves no business result. Resolve or hand off a dependency before revising its task scope.

Current and historical waits are distinct. Bounded summaries retain a short reason and condition; `ref:"waiting"` returns the owned details. Page assets identify the document and whether its control is current or historical. Releasing a page preserves historical facts without making its references usable again.
