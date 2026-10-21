# Task graph repair qualification

Date: 2026-10-22. Repair baseline: `7218b3ca810b66ea8211721d30e0b969d64ff793`.
Product candidate: `c1f3568` and its tracked runtime artifacts. Target Harness:
`687f282e8625c6b8d11ff58211a90524be2e4317`. Subsequent qualification edits change
only documentation and the target fixture. This record supplements
[the preceding graph qualification](graph-repair.md); historical receipts remain
byte-preserved in private storage.

## Repair results

| Finding | Result | Evidence |
|---|---|---|
| Receipt blocking before persistence | PASS | Invalid duplicate, wrong-attempt and losing concurrent receipts leave live state unchanged; synchronized unknown receipts and storage failures still block writes, including after recovery |
| Failed task creation | PASS | Exclusive allocation and confirmed-unregistered cleanup; post-write registry errors, uncertain registration and cleanup failure preserve files and contain the Session; recovery never adopts orphan directories |
| Duplicate proof edge IDs | PASS | Distinct criterion-specific edges pass complete detail validation; missing, duplicate, foreign and forged edges are refused |
| Replay-order edge validation | PASS | Forward and permanently dangling edges retain skip semantics; backward recorded relations and generated proof edges are checked by complete identity |
| Pre-RPC worker collection | PASS | Controlled timeout/cancellation races and actual Windows idle exit; unconfirmed exit retains ownership and capacity |
| Repeated evidence reads | PASS | A normal task observation reads its unchanged proof once instead of three times; shared attachments are reused only within the read; replacement, deletion, mutation and changed run/journal cannot publish a valid stale proof |
| Display budget diagnosis | PASS | Invalid view budgets fail before acquisition; Go reports `invalid_budget` for negatives, while zero-budget internal preparation and complete detail reading succeed |

Multiple passed criteria are an internal graph interface test. The Host still
provides one current trusted workflow criterion and does not promote old-run
criteria into current facts.

## Executed checks

- `DSH_CHECKOUT=<fixed-target-checkout> npm run verify`: **468 passed**, 0 failed,
  0 cancelled, 0 skipped. All seven strict TypeScript compiler faces, Client
  build checks, installed-package/plain-Node loading and declaration consumption
  completed. Go: **23 passed**, 0 failed, 0 skipped.
- A tracked-source copy without local tasks installed its locked development
  dependencies, built all products, passed strict checking and **59 focused
  infrastructure tests**. All **55 runtime artifacts** matched the product
  candidate byte for byte.
- Actual packaging and installation without development dependencies loaded and
  unloaded six tools and seven routes using plain Node, without a task directory.
  Public file, archive, nested dependency and reachable-history scans found no
  private task data, machine paths or credentials.
- Fixed-target Windows Host fixture: **16 checks passed**. A 16,001-event
  projection took approximately **0.98 seconds** with the default five-second
  request budget. Its complete **19,695,394-byte** graph detail was validated
  across frames. A separate 64 KiB-frame case also completed. The fixture checked
  pre-RPC idle exit, changed-original proof invalidation, independent fact-detail
  verification and managed process disposal.
- Actual target Desktop was restarted with paired Host, Client and kernel v3.
  Electron **44.7.0**, Desktop Host Node **24.21.0**; the separate Windows Host
  fixture used Node **22.23.2**. The served Client matched the candidate bundle.
  Two new normal Agent Sessions each completed `await_user`, task observation,
  initial graph detail and version-bound continuation through the ordinary
  composer/tool path. Both returned kernel v3, their own goal and wait, and no
  counterpart private marker.

The first qualification invocation exposed a fixture import mixing source and
built class types. The fixture now consumes the built graph implementation;
that failed output and the subsequent passing invocation are both preserved.
No product assertion was removed, skipped or weakened.

## Compatibility and remaining acceptance

Internal RPC remains v2; kernel serialization is v3 and cold rules remain
`structural-v1`. Reload matching Host and Go artifacts together. External graph
continuations bind the kernel version as well as the safe input digest; restart
at offset zero after upgrading. Browser Flow v3, Desktop bridge v1 and journal
format v1 remain unchanged. See the [upgrade guide](../upgrade-guide/v0.1.0/go-graph/guide.md).

Real login, manual page authorization/revocation, real table save/readback,
website navigation and business import remain **NOT_RUN** for this candidate.
Synthetic inventory and evidence fixtures do not establish these results or
BF0/BF1 completion. The seven review fixes and local/target infrastructure
qualification are complete; website acceptance is separate.
