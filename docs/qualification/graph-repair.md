# Graph repair qualification

This qualification covers the nine graph review findings on Windows x64 with
Harness `687f282e8625c6b8d11ff58211a90524be2e4317`, Electron 44.7.0 and Host
Node 24.21.0. It covers synthetic infrastructure behavior, not website acceptance.
Private task records, process identities and raw receipts are not published.

## Findings and evidence

| Finding | Repair and regression evidence |
| --- | --- |
| Repeated full replay | Incremental live-intent contributions and dirty cold stamps; original seven algorithms, transition-by-transition reference comparison and a linear visit bound pass. |
| Budget-dependent preparation | Input identity is independent of display budget; concurrent summary/detail/view reads share preparation through a bounded serial queue. |
| Committed operation reported as storage failure | Cancellation/revision return committed results; recovery confirms their state despite failed graph retirement. Actual journal failures still refuse writes. |
| Failed cleanup loses ownership | RPC listeners detach immediately; failed/unconfirmed exits retain capacity. Retrying exit observation and synchronous termination failure regressions pass. Disposal joins owned ranges. |
| Detail exceeds a frame | Internal v2 fragments are assembled, strictly decoded and fully validated before model output. Corrupt, duplicate, inconsistent, foreign and over-capacity replies are refused. |
| Missing page asset identity | Page summaries restore document tokens. Host authority supplies current/historical validity and reevaluates it after release. |
| Unused policy declaration | Removed the unused export. Actual compiled action policy and forbidden-action regressions pass. |
| Repeated executable hashing | One successful verification per plugin instance; later spawns check file identities. Replacement requires reload and failed verification remains retryable. |
| Historical detail starts a worker | Read-only and damaged histories refuse derived details before graph construction; safe original details remain readable. |

## Executed checks

- Plugin `npm run verify` explicitly selected the fixed target checkout:
  **437 passed, 0 failed, 0 cancelled, 0 skipped**. This includes strict compiler
  checks, 13 Client build checks, actual package installation under plain Node,
  declaration consumption, six tools and seven routes without local tasks.
- Go: **22 tests passed**, including all seven extracted algorithm tests.
  The worker command package contains no tests and is built explicitly.
- Windows target Host: **13 checks passed**, including actual managed workers,
  two task owners, waits, crash/reconstruction, release with old reads/writes
  refused, full large details and quiescent disposal.
- Two normal Desktop Agent Sessions each executed `await_user`, task summary,
  graph detail and projection-bound continuation through the normal composer
  and tool registry. Both retained their own goals and waits; neither exposed
  the other task's private marker.
- The target checkout is clean and all 12,637 reused target artifacts match
  their recorded hashes. The actual served Client matches the rebuilt bundle.

Single-run Linux replay measurements for 1,001 / 2,001 / 4,001 / 8,001 /
16,001 events were approximately 0.008 / 0.015 / 0.032 / 0.060 / 0.123 seconds.
On Windows, the managed 16,001-event projection completed in approximately
0.44 seconds under the default five-second budget. Complete detail reads passed
with 64 KiB frames and with a 19,695,394-byte detail exceeding the default 8 MiB
frame. These are recorded observations, not shared-CI timing assertions.

## Remaining acceptance

Real logged-in same-page operation, manual page authorization/revocation, real
table save/readback, live website navigation and real business import remain
**NOT_RUN** for this candidate. Synthetic release checks do not replace them.
This qualification does not establish BF0/BF1 or overall business completion.

The [upgrade guide](../upgrade-guide/v0.1.0/go-graph/guide.md) covers paired
Host/Client/worker reload, internal v2 and projection-bound continuation.
