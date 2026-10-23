# Upgrade Browser Flow to v3

Reload both Host and Client after installing the new package. Browser Flow v3 rejects v1/v2 commands and receipts; the Electron Desktop bridge still uses v1. There is no page-dispatch fallback without a task.

Use a normal `dsh` profile. `localTasksDir` accepts a local absolute directory; when omitted it resolves to `profileContext.home/browser-flow/tasks`. Keep any explicit directory in private profile configuration. Do not point it at an installation directory or `node_modules`. `taskStoreDir` was never implemented and is not an accepted alias. The legacy `importEvidenceDir` option no longer places new data outside a task; retain old evidence privately in its original location.

In Browser Flow create or open the Session's task, then explicitly authorize the desired page. Each Session permanently binds to at most one task, even after cancellation or handoff. New batches require a new Session. Generic tasks specify a goal and exact allowed origins without a site definition. Local workflows take versioned private snapshots at task creation; editing the local definition affects new tasks only. Current adapters must support the snapshot's version.

`browser_observe(view:"task")` reads the bound task without page authorization. Normal tabs/observe/find/act/wait require the task; page access additionally needs the user's page grant. Task creation/open/revise/cancel/finish use branches of the existing authorize route; page and file authorization remain separate branches. Commands, receipts and file grants carry an immutable task/run scope. Host checks it independently of panel, generation, Session, lease, epoch, command and sequence. Revisions revoke control and require explicit page authorization again. Cancellation and finish record task lifecycle, never a business success.

`browser_release` and manual revocation do not depend on task-log availability or the latest task revision. They detach control while retaining the page. Startup never restores control, element references or file grants. A write with an unknown result blocks every later `browser_act` and new file grant for that task; new runs, revisions and restarts do not clear it. Read safely, revoke and hand off.

Task definitions, input bytes, private responses and detailed task acceptance stay in ignored `tasks/`. Install the package without those files to get the infrastructure and six tools; distribute local definitions separately. Missing or damaged definitions do not supply a hidden built-in workflow and do not prevent generic infrastructure loading. Historical evidence belongs to its original version and remains unchanged locally.

## Task storage generation 1

New manifests, ownership records and hash-linked journal events use schemaVersion 1. Unknown versions, event discriminators and invalid payloads cannot restore write access. A damaged task retains its original bytes and ownership; independent tasks continue.

Unversioned task history is read-only. Use its task view, revoke and hand off; create a new Session for new work. No migration, replay, new page grant, file grant or revision is available for that history. Cancel/finish still withdraw control and return an explicit read-only handoff; they do not modify the old lifecycle or journal. Old business labels are historical and unverified by this generation.

## Evidence-backed criteria

Business verdicts require recoverable originals and the exact task/run, criterion and validator version. Prior bare verdict labels remain historical/unverified; they are not upgraded into proofs. Generic goals and free-text criteria have no implicit business-success validator. Supported trusted adapters supply their own fixed predicates. Criterion and graph details are available through existing task observation references.

## Paired graph kernel v4 upgrade

Install the Host and packaged Windows helper from the same build. Kernel v4 adds
task-local resource grouping, `graph:assets`, `graph:exploration`, opaque resource
details and Host-owned `coverage`. It rejects a kernel-v3 helper or continuation
identity; begin new detail reads at offset zero. Browser Flow v3, RPC v2 and
journal generation 1 stay unchanged. No historical asset is rewritten, and its
original UUID still identifies the same snapshot. See [the identity and query
contract](graph-kernel.md#kernel-v4-task-local-resource-and-exploration-views).

Free-text criteria remain in the coverage denominator with `no_validator`.
Coverage is informational and does not complete a task or establish business
success. Old records without reliable identity stay independently queryable.

Definition snapshot reads now advertise `definition:<path>` references, including
instruction `ref` fields and the summary's `resources` array. Use the explicit
reference for a file whose name overlaps a system detail, such as
`definition:coverage`. Ordinary old bare paths remain aliases. Existing snapshots
and filenames are preserved, including when a task is recovered.

## Agent-declared waits

`browser_act` now has a Host-only `await_user` branch requiring only `action` and the bounded `wait` declaration. Page actions still require documentToken and elementRef. The six tools and seven routes are unchanged; the existing task route additionally accepts the user's resume operation. Update tool consumers and reload both Host and Client. The model cannot resume, authorize a page, confirm a file or write a verified result through this branch. Unknown-outcome write blocking includes await_user.
