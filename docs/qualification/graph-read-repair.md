# Scoped graph read repair qualification

Date: 2026-10-22. Baseline: `1254847`. Product commits: `a3fe311`, `3f8580b`
and `6ec8c21`. Target Harness: `687f282e8625c6b8d11ff58211a90524be2e4317`.
The qualification changes the target fixture and documentation; the product
remains `6ec8c21`. Earlier qualification records retain their own candidates.

## Results

| Surface | Result | Executed evidence |
|---|---|---|
| Evidence content | PASS | Final bounded reads verify each unique original's digest even with unchanged reported metadata; all dependent proofs are invalidated on failure |
| Request-local reuse | PASS | An unchanged unique original is read at most twice per fact request; shared attachments reuse initial bytes; later requests verify independently |
| Retirement reads | PASS | Idle and I/O retirement, concurrent readers, bounded per-task admission, cancellation, timeout, observation failure and service disposal retain ownership until confirmed exit |
| Offset preflight | PASS | Current-identity impossible offsets perform zero graph/evidence work; known lengths survive worker retirement; unknown invalid lengths are rejected before evidence verification |
| Complete continuation | PASS | Actual scoped Go detail exceeds two million characters and reconstructs exactly, including Chinese and emoji; exact-end offsets return empty completed text |
| Capacity and isolation | PASS | Canonical Host JSON obeys the UTF-8 capacity; task/projection changes cannot reuse stale lengths; existing graph fragment validation and proof isolation remain enabled |
| Dead state | PASS | Unread `Worker.busy` and its assignments are removed; serial RPC queues remain authoritative |

The fixed-metadata counterexample uses a controlled metadata provider. It does
not demonstrate a metadata-preserving attack on the target volume. Final content
verification observes bytes at the last read; it is not an atomic filesystem
transaction. Historical one-read measurements remain unchanged and do not
describe this candidate's two-read cost.

## Checks and retained failures

- `DSH_CHECKOUT=<fixed-target-checkout> npm run verify`: **507 tests, 506 passed,
  1 failed, 0 cancelled, 0 skipped**. The failure was the package installation
  subprocess's npm timeout. Go tests, all seven strict compiler faces and
  **13 Client build contracts** passed.
- The same candidate's **2 package tests passed** on focused rerun using the
  local npm cache. Actual installation, plain Node loading, published declaration
  consumption and six-tool/seven-route registration and disposal passed. The
  failed comprehensive run is retained; it is not relabelled as a green run.
- Focused repair checks passed: **21 evidence/fact**, **21 worker** and
  **51 detail/output/projection** checks, including the large continuation.
  These overlap the comprehensive suite and are not additional unique totals.
- A tracked-file-only copy without local tasks installed locked dependencies,
  built and passed strict checking and **5 focused infrastructure tests**.
  All **55 runtime artifacts** matched byte for byte. Its first graph checks
  lacked the local test helper; after building that helper, the checks passed.
- Actual package installation without development dependencies or local tasks
  passed. Source, runtime binaries, nested dependency archives and reachable
  history passed privacy checks.
- **19 Windows target Host checks** passed using actual managed Windows workers:
  retirement before replacement, scoped offset rejection, exact-end continuation,
  changed-content proof invalidation and complete detail over 64 KiB and 8 MiB
  frames. The 16,001-event projection completed within the default request
  budget. Target sources were clean and **12,637 artifacts** matched the retained
  target-build manifest.
- The target Desktop loaded matching Host/Client artifacts. Actual Electron was
  **44.7.0**, Host Node **24.21.0**, Desktop bridge **v1** and Browser Flow **v3**.
  Two normal Agent Sessions each recorded a wait, a task view and two graph detail
  reads with a matching projection identity. Both returned their own goal and
  excluded the other's private marker. No page or file authorization was granted.

The first Windows fixture launch used a Linux-only source-loader binary and
failed before executing the fixture. The successful run used the strictly
compiled fixture with identical built product artifacts under Windows Node.
The first large fixture was below two million characters; its inventory was
increased and the complete continuation check passed. All failed outputs remain
private alongside their successful reruns.

## Product identity

| Artifact | SHA-256 |
|---|---|
| `src/task-store.ts` | `470a50571919039316a27f393cc4bd706238202a5faca9be86a5635a42315cd7` |
| `src/graph/worker.ts` | `7e64a8f8ee12b17488cdbdb736bdc68c71a6f2b34d5eb4110339db623643fd6b` |
| `src/tools.ts` | `e3cee3f28c0492ab339f938ae6a4e250de0fa5933e75b704c187a3d598fadc4a` |
| `lib/host/task-store.js` | `d72fcb0f5a9457955827b3e6b2dfb9a60c406642df2836ae3b27a79c70f3a5c0` |
| `lib/host/graph/worker.js` | `354de14c81c470552039fe713574e33e1026cc912d9cbafdea643172d7a249f7` |
| `lib/host/tools.js` | `cfd15ea3ae2b9ce2a6ecc5b43409cc0bae0591b89c3d7a21d4b6d34ea7fb9b53` |
| `lib/client.js` | `163aca5ef0c78d5a5fd03807fe6d783c25e539737792d5a16538410aaf36e6f1` |
| Windows Go worker | `71aa4ec469d751914ca3b6cbce23ef0578e3df9b634a743d31b8be8631e16b07` |

Detailed receipts, original failed runs, process/configuration identities and
task records remain in ignored private storage. Historical evidence bytes are
preserved. See [the upgrade guide](../upgrade-guide/v0.1.0/go-graph/guide.md).

## Separate acceptance

This qualifies the four scoped graph-read repairs. Six tools, seven routes,
Browser Flow v3, Desktop bridge v1, Go RPC v2, kernel v3 and journal v1 are
unchanged. Go output never grants control or replaces Host evidence judgments.
Real login, manual authorization, table save/readback, website navigation and
business import remain **NOT_RUN**. This does not declare BF0 or BF1 complete.
