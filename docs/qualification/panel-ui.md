# Control panel UI qualification

Date: 2026-10-22. Baseline: `8e3393e`. Product commits: `ecdf848` and
`91fb3c8`. Target Harness: `687f282e8625c6b8d11ff58211a90524be2e4317`.
The qualification commit adds a matching platform substitute to an existing
revocation test, documentation and this record. Product artifacts are unchanged.
This supplements [the task graph qualification](task-graph-repair.md).

## Results

| Surface | Result | Executed evidence |
|---|---|---|
| Host components and theme | PASS | Actual target Button, Input, Tag, StateDot and DisclosureRow; scoped CSS embedded in the Client, owned by plugin effects |
| Compact layout | PASS | Fixed connection/authorization/revocation header; task, persistent notices, page cards, conditional file review and expandable diagnostics |
| Task interactions | PASS | Normal Desktop creation and revision; drafts survive polling; Escape cancels editing without a request; new Session drafts and task identities are isolated |
| Wait and safety presentation | PASS | Read-only, blocked, cancelled, handed-off, disconnected, absent Agent/page and unsupported-host states; waits retain explicit authorization and file preparation, while Host write restrictions remain authoritative |
| Responsive layout | PASS | 96 synthetic presentation cases: light/dark × 280/320/390/480 CSS px × 12 states; no root/content horizontal overflow or button-content clipping; header remains visible during scrolling |
| Keyboard | PASS | Tab reaches a visible focus ring; Enter/Escape open and close details; Escape returns edit focus; resizing preserves focused input and its draft |
| File review | PASS | Supported authorized import only; complete path, kind, rows, bytes, SHA-256 and stop condition remain accessible before confirmation; changed input clears its preview |
| Lifecycle | PASS | Presentation changes do not restart polling; same panel instance and connection generation across creation/revision; stylesheet remains shared through fixture mounts and is removed on plugin disposal |
| Startup and reload | PASS | Final paired cold start, uninstrumented renderer reload and normal panel requests succeeded; served Client matches the candidate |

The 96-case matrix runs the production presentation and stylesheet with actual
Host primitives in the target Electron renderer. Its controlled states and
callbacks are synthetic. It sends no page authorization, file confirmation or
website action, and does not establish human consent. The normal panel checks
use unmocked Host requests in two synthetic Sessions; no model or website action
is submitted. Automated interaction is not manual authorization acceptance.

## Checks and retained failures

- `DSH_CHECKOUT=<fixed-target-checkout> npm run verify`: **491 passed**, **0
  failed, 0 cancelled, 0 skipped**. All strict compiler faces, Go tests and
  **13 Client build checks** passed. Existing revocation, remount, identity,
  unknown-write and one-file-dispatch negative tests remain enabled.
- The first comprehensive run had **481 passed and 10 failed** because an old
  revocation-test platform substitute omitted the newly required UI module.
  That substitute now uses the shared fixture controls and an explicit import
  workflow. All ten original assertions passed; none was removed or skipped.
- A copy made only from tracked candidate files, without local tasks, installed
  locked dependencies, built, passed strict checking and **8 focused
  infrastructure checks**. All **55 runtime artifacts** matched byte for byte.
- Actual package installation with no development dependencies loads and unloads
  **six tools and seven routes** under plain Node without local task data.
  Package, nested dependency and reachable-history privacy checks pass.
- Target sources are clean; **12,637** target artifacts match the retained
  target-build manifest. Actual Electron is **44.7.0**, Host Node **24.21.0**,
  Desktop bridge **v1**, Browser Flow **v3**.

Intermediate renderer reloads during qualification failed plugin activation and
produced a Desktop error dialog. Those failed runs and crash reports remain
private and are not counted as passes. The final checks run after a full exit
and paired Host/Client restart, with the build complete; cold start, renderer
reload and normal task UI then pass. The earlier live Desktop log had appended
shutdown output: its original hashed bytes remain an exact prefix and are also
retained separately. No historical record was replaced.

## Artifact identity

| Artifact | SHA-256 |
|---|---|
| `src/panel.ts` | `f383d14bc7b96f77b19f44fea653d70217399922d17d1c4019ee3cf346adbc5a` |
| `src/panel-view.ts` | `9ebe1fec19cf203ac51f0495467716e4a2a9b01adede30b31a2eccd2422c584a` |
| `src/panel-ui.ts` | `2bd68a44afe64bfa50da0f0fadb929ca83f2d7f1007dad1245712a9f92b64014` |
| `src/panel.css` | `09e4079d4e1191568f8f07c800f9e6fc985303064dcc6ed45a0b092cf73e9124` |
| `src/client-wire.ts` | `7b81a014a0274725493f909ce2f7bcd25c274b178fa1013556e5a05cc51c477c` |
| `lib/host/index.js` | `b0533b77d49d47438fb454335d71bfd5a81474f45d21ca263fb8590668ff162b` |
| `lib/client.js` | `163aca5ef0c78d5a5fd03807fe6d783c25e539737792d5a16538410aaf36e6f1` |

Detailed receipts, process/configuration identities, screenshots and task data
remain in ignored private storage. Public records contain portable conclusions
and artifact identities only. See [the upgrade guide](../upgrade-guide/v0.1.0/panel-ui/guide.md).

## Separate acceptance

UI implementation and fixed-target Desktop UI qualification pass. Real login,
manual page authorization/revocation, table save/readback, website navigation and
business import remain **NOT_RUN** for this candidate. This does not declare
BF0, BF1 or business delivery complete. Harness source, six tools, seven routes,
Browser Flow v3, Desktop bridge v1, journal v1 and Go responsibilities are unchanged.
