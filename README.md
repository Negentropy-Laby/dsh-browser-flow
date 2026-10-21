---
kind: package-bundle
description: "Let an Agent operate an explicitly authorized page in the existing Desktop Sidebar Browser."
---
# @negentropy/dsh-browser-flow

## Summary

Let an Agent observe and operate a page that you already opened and logged into
in DeepSeek Harness Desktop's Sidebar Browser. Create a task, explicitly authorize
its page, and revoke control whenever needed while keeping the page open. Task
instructions and private run data remain outside the distributed package.

## Table of Contents

- [Install](#install)
- [Use a task](#use-a-task)
- [Tools](#tools)
- [Protocol and safety properties](#protocol-and-safety-properties)
- [Privacy](#privacy)
- [Configuration](#configuration)
- [Development and verification](#development-and-verification)
- [Known limitations](#known-limitations)

## Install

Use an existing DeepSeek Harness Desktop profile. From this repository, install
the locked dependencies and build the Client:

```sh
npm ci
npm run build
```

Fully quit Desktop, then install the plugin through the normal `dsh` CLI.
Replace the placeholders with your profile name and the absolute checkout
directory; no installation directory is assumed:

```text
dsh plugin --profile <profile> add "link:<absolute-plugin-directory>"
```

Start Desktop through that profile. The package's [profile patch](cordis.patch.yml)
registers the Host and Browser Flow panel without modifying Harness source.
A linked installation uses the checkout; rebuild after changes and reload both
Host and Client together. Browser Flow uses protocol v3; mismatched peers are
rejected. See the [upgrade guide](docs/upgrade-v3.md).

## Use a task

1. Open the intended page in Sidebar Browser and log in yourself.
2. In Browser Flow, create a task with a goal and exact allowed origins, or select
   an available local definition and workflow. Each Session permanently owns at
   most one task; use a new Session for a new batch.
3. With an Agent active in the Session, click **Authorize control** for the intended
   page. Creating a task does not authorize a page.
4. Ask the Agent to read `browser_observe(view:"task")`, then work from fresh page
   observations and current element references.
5. Revoke control in the panel or call `browser_release`. The page remains open.

Use **fixed instructions + model step-by-step orchestration + code validation**.
Instructions define allowed work and completion criteria; the model chooses the
next step; Host and Client validate permission, identity, references and results.
See the [workflow standard](docs/workflow.md) and [local task guide](docs/local-tasks.md).

Task definitions, business instructions, input files, local configuration and
detailed receipts belong in the private task store. This repository supplies
infrastructure and trusted validators, without a bundled local task or an
automatic website business state machine. Missing definitions do not prevent
the plugin and its six tools from loading.

## Tools

| Tool | Purpose |
|---|---|
| `browser_tabs` | List this Session's eligible pages, redacted addresses and authorization state |
| `browser_observe` | Read a bounded page view, the current task, or an adapter-supported structured view |
| `browser_find` | Locate by visible text, explicit attribute or ARIA role; refuse ambiguity |
| `browser_act` | Click, replace text, select an option or set a checkbox; supported adapters can permit one confirmed file selection |
| `browser_wait` | Wait for a bounded, cancellable DOM condition |
| `browser_release` | Withdraw control while retaining the page |

`browser_act(action:"await_user", wait:{kind, reason, resumeCondition})` records a
task dependency without a page target or page authorization. Only the user can
provide the missing condition and resume it. Resume grants no permission and
certifies no business result.

Text lookup retains the deepest visible matches. One nested label counts once;
separate controls with the same text remain ambiguous. No tool runs arbitrary
page JavaScript. A dispatched action does not prove its business effect.

## Protocol and safety properties

Host and Client use the authenticated existing `/api` connection and seven
`/api/browser-flow/` routes: `hello`, `poll`, `result`, `invalidate`, `authorize`,
`revoke` and `status`. The Desktop bridge remains at its independent version 1.

- Page access requires the current task and explicit permission bound to the
  exact Agent, Session, guest, connection generation, lease, epoch and document.
- Each Agent and Session has one current control page. A validated replacement
  withdraws the old grant; a failed replacement preserves it.
- Receipts must identify the delivered command's panel, Session, generation,
  task/run, lease, epoch, ID and sequence. Old or foreign replies cannot settle it.
- UI revocation stops local dispatch before the HTTP reply. Release and revoke
  do not depend on task-log availability and keep the page running.
- Commands use relative remaining budgets. Host waiting time and Client-local
  waiting are deducted; cross-process clock equality is not assumed.
- Same-origin navigation invalidates old document references. Cross-origin
  navigation, guest replacement and reconnect retire control.
- Delivered commands are never replayed. An unknown write result blocks further
  writes to that task through restarts and revisions; read safely, revoke and
  hand off.

Trusted adapters add explicit restrictions and evidence-based predicates.
Generic tasks do not inherit a site's endpoints, file permissions or success
validator. File tools accept an opaque, user-confirmed grant rather than a disk
path. A permitted selection is one attempt; uncertainty never triggers a retry.

## Privacy

Observed page text and tool arguments enter the current Agent Session and may be
sent to its model. Refusing a tool call cannot remove arguments Harness already
logged. The page programs refuse password fields and do not read cookies,
storage or authentication tokens. Returned addresses redact recognized sensitive
query values. Visible page text is not automatically anonymized.

Private files, task instructions, response originals, runtime identities and
detailed receipts must not enter the public repository or distribution archive.
The ignored `/tasks/`, `/.evidence/` and `/.cache/` directories hold local data;
Git ignore rules do not remove information embedded in another tracked file.
Review the complete files and reachable history before publishing.

## Configuration

Override the `browser-flow` row's `config` through the profile. Invalid values
fail validation rather than silently falling back.

| Field | Default | Meaning |
|---|---|---|
| `commandBudgetMs` | 15000 | End-to-end command deadline in milliseconds |
| `observeMaxChars` | 8000 | Character budget per observation |
| `observeMaxNodes` | 400 | Element budget per observation |
| `findMaxMatches` | 20 | Maximum returned candidates without hiding ambiguity |
| `waitMaxMs` | 10000 | Maximum DOM wait; bounded by the command budget |
| `queueLimit` | 4 | Pending operations per page |
| `pollWaitMs` | 20000 | Maximum single panel poll |
| `connectionIdleMs` | 60000 | Idle connection expiry |
| `importWindowMs` | 25000 | Supported passive import observation window |
| `localTasksDir` | empty | Private task root; defaults to `profileContext.home/browser-flow/tasks` |

Configure local absolute directories in your private profile, never in committed
examples. Missing task directories are initialized lazily. An unwritable store
cannot enable task writes; permission withdrawal remains available.

## Development and verification

```sh
npm run build
npm run typecheck
npm run verify
```

Typechecking uses `DSH_TSC` or a compiler in a local/sibling Harness checkout.
Inspect the output: absence of a compiler is reported as a skip. Host tests also
report skips when their optional artifacts are unavailable. Automated checks
and synthetic fixtures do not establish logged-in website or business acceptance.

See [testing](docs/testing.md) for explicit Host artifact inputs and local-only
receipts. The package whitelist distributes `src`, `lib`, generic documentation,
the profile patch and the pinned runtime dependency; it excludes local tasks and
recorded runs.

## Known limitations

- Main-document DOM only: screenshots, visual input, cross-origin frames, canvas
  tables and virtualized data are unsupported.
- Actions need the live visible Desktop guest. Web hosts cannot execute these
  programs through their cross-origin Sidebar iframe.
- The user handles login, page permission, file confirmation and business consent.
- No arbitrary script execution, automatic business submission or write replay.
- Task completion and a user ending a task are separate facts. Unsupported or
  missing business evidence remains unverified.
