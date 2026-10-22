# Bounded evidence and task detail qualification

Date: 2026-10-22. Baseline: `c4e714c`. Product commits: `dae9015`, `8527a8c`
and `d8064a8`. Target Harness: `687f282e8625c6b8d11ff58211a90524be2e4317`.
The qualification adds fixture coverage and documentation; the product remains
`d8064a8`. Earlier records and their original results remain unchanged.

## Repair results

| Surface | Result | Observed behavior |
|---|---|---|
| Artifact allocation | PASS | Real files starting at 4 KiB and growing to 32 or 128 MiB use one 4,097-byte read buffer and at most 4,097 bytes of reads; growth returns `task-evidence-mismatch` |
| Short reads and cleanup | PASS | Positional reads assemble unchanged bytes; ongoing growth, early EOF, truncation, replacement, digest mismatch and I/O failure reject without leaking the evidence handle |
| Evidence paths | PASS | Initial reads, final content rechecks, discovery with `verify=false` and proof write/readback all use the bounded entry; the exact 16,000,000-byte original limit remains enforced |
| All detail offsets | PASS | Offsets over configured capacity reject before dispatch, graph acquisition or evidence I/O for assets, criteria, individual criteria, goals, waits, snapshots, graphs and digests |
| Detail capacity | PASS | Every canonical detail JSON obeys the configured UTF-8 byte capacity; exact-end JavaScript character offsets remain valid; within-capacity offsets still use actual length checks |
| Original snapshots | PASS | Real appends during evidence reads and after the inner guard cannot produce a successful mismatched `contextVersion`; invalidated runs retain binding errors; later appends allow consistent old replies |
| Safety | PASS | Evidence ownership, two-phase content verification, concurrent-read guards, stale projections, unknown-write blocking and independent permission withdrawal retain their regression coverage |

The allocation bound applies to each artifact read, including its sentinel byte;
it does not assert constant total Host memory. Successful fact reads still verify
each unchanged unique original at most twice. Request-local byte sharing is not a
cross-request proof cache. Final content rechecks observe the last read rather
than providing an atomic filesystem transaction.

`graphMaxDetailBytes` now applies to original task details as well as derived
details, with the same default 32 MiB and accepted configuration range. Oversized
original details report `task_unavailable` with `detail_capacity`. The tool schema
and Store independently reject offsets over this limit. Valid continuations over
two million characters, UTF-16 character offsets, exact-end replies and existing
projection identities remain supported.

## Executed checks

- `npm_config_offline=true DSH_CHECKOUT=<fixed-target-checkout> npm run verify`:
  **529 tests passed, 0 failed, 0 cancelled, 0 skipped**. Go regressions, all seven
  strict TypeScript compiler faces and **13 Client build contracts** passed.
  The worker command package reports no test files; its behavior is exercised by
  the process tests and target fixture.
- Focused checks: **30 artifact/evidence/fact checks**, **1 additional artifact
  I/O-close check**, **36 detail/output checks** and **44 snapshot/adjacent
  checks** passed. These groups overlap each other and the comprehensive suite;
  their counts are not additional unique tests.
- A tracked-file-only copy without local tasks installed locked dependencies
  offline, built, passed strict checks and **5 infrastructure checks**. All
  **55 runtime artifacts** matched the candidate byte for byte.
- Actual package installation without development dependencies or task data
  passed plain Node loading, six-tool/seven-route registration and disposal.
  Source, generated runtime, native binary, nested archives and reachable history
  passed privacy inspection. Detailed originals remain in ignored storage.
- **25 Windows target Host checks** passed under Windows Node **22.23.2**, using
  the fixed target's actual Cordis, tools and subprocess provider with identical
  built plugin artifacts. Checks include file growth and allocation measurements,
  original detail limits, the late-append race, evidence invalidation, owned
  retirement and complete detail over 64 KiB and 8 MiB frames. The 16,001-event
  projection took approximately **567 ms** within the default 5-second budget;
  its complete detail was **19,695,394 bytes**. This measurement is not a CI timing
  threshold.
- Target sources were clean and **12,637 artifacts** matched the retained build
  manifest. The restarted Desktop loaded the matching Host and served Client,
  with Electron **44.7.0**, Host Node **24.21.0**, Desktop bridge **v1** and Browser
  Flow **v3**. An uninstrumented renderer reload passed.
- Two normal Desktop Agent Sessions each recorded **6 tool calls**: wait,
  original goal detail, an expected extreme-offset `invalid_request`, task view,
  initial graph detail and continuation with the returned projection identity.
  Goals and private markers stayed isolated. No page or file authorization was
  granted by these synthetic checks.

Permanent counterexamples failed before repair: growing-file allocation, raw
offset preflight and the real append microtask window. Their failed outputs are
preserved separately from successful reruns. The earlier candidate's package
network timeout retains its original failure; this candidate's comprehensive run
used the complete local npm cache in offline mode. Historical UI evidence remains
attached to its original candidate; the unaffected 96-case matrix was not rerun.

## Product identity

| Artifact | SHA-256 |
|---|---|
| `src/task-store.ts` | `0606ee5ed1c74d2b2e0ebe8bf28048de55916d7134753126d9a75db8eac971a0` |
| `src/tools.ts` | `8b9aad1f94a9c1c6da57a7f3bb6d7d26f51d6ab3d3f6691f962e246a07553674` |
| `lib/host/task-store.js` | `516b5d72774d0efe7b2f0d4024c8f5955bedeb2eca8babb1133638b981025e1a` |
| `lib/host/tools.js` | `df09c8a565b64c3c0099bd8b6ac8d7df2753a573eb24bb27817beb79642a6087` |
| `lib/client.js` | `163aca5ef0c78d5a5fd03807fe6d783c25e539737792d5a16538410aaf36e6f1` |
| Page programs | `a920e3a2ad10bcc8c34cfa58a344d5163d55ec9e12ebe713a6b7bea1d8b15f30` |
| Windows Go worker | `71aa4ec469d751914ca3b6cbce23ef0578e3df9b634a743d31b8be8631e16b07` |

Private receipts bind the actual process, configuration, supplied bundle, full
artifact inventory and Session logs to this candidate. Public records contain
only portable synthetic checks and sanitized conclusions. See the
[upgrade guide](../upgrade-guide/v0.1.0/go-graph/guide.md).

## Separate acceptance

This qualifies the three bounded-evidence and task-detail repairs. Six tools,
seven routes, Browser Flow v3, Desktop bridge v1, journal v1, internal Go RPC v2
and kernel v3 remain unchanged. Harness source is unchanged.

Real login, manual authorization/revocation, table save/readback, website
navigation and business import remain **NOT_RUN**. This does not declare BF0,
BF1 or business acceptance complete.
