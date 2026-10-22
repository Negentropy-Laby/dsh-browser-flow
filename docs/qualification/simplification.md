# Internal and runtime distribution simplification

Date: 2026-10-22. Baseline: `b55dd017c2ef7217606688d2c15078e17eb29ecc`.
Product commits: `86dee52`, `1c20d3f`, `79c9dda`, `27e3e29` and `8e17145`.
The runtime candidate is `8e17145`; this qualification also corrects an obsolete
source-distribution test expectation and updates documentation. Target Harness:
`687f282e8625c6b8d11ff58211a90524be2e4317`.

## Delivered scope

| Area | Result | Verified change |
|---|---|---|
| Unused build support | PASS | Client JSON imports explicitly reject; the unused embedding branch is removed |
| Host artifacts | PASS | Client-only import builders remain in source and the Client bundle; their unused Host JS and declaration are removed |
| Fixed programs | PASS | Verification metadata is generated in ignored build storage; runtime JS remains distributed with a generated declaration identical to the source declaration |
| Runtime package | PASS | Source, testing instructions and qualification records remain in Git; the archive contains runtime artifacts, required declarations, user guides, profile patch, dependencies and licenses |
| Page internals | PASS | Unused runtime aliases and the duplicate element-reference write are removed; public `prelude()` output is byte-identical |
| Client compilation | PASS | One configuration serves checking and generation, with separate incremental records and cleanup limited to owned Client outputs |
| Test wiring | PASS | Four dependency resolvers and two DOM Host/command fixtures share existing helper infrastructure; the four scenario bodies are byte-identical |

Removed tracked files are `lib/host/import-page.js`, its declaration,
`lib/page-programs.json` and `tsconfig.client.emit.json`. The new runtime page
declaration replaces the package's source-type dependency. Test wiring removes
185 net lines across the four consumers and shared helper. Independent refusal,
table-save, file-selection and second-page scenarios remain separate.

Public export names, function arities, existing declaration fields and callback
signatures remain unchanged. All 24 retained generated declarations match the
baseline bytes. Public idle protocol exports and control-state fields remain
available. Source, historical qualification records, expected tool outputs and
private task data are preserved.

## Measured archive

The baseline was packed from the exact baseline Git tree with its locked runtime
dependencies. Both measurements use actual npm archives, including bundled
dependencies; repository source size is not used as the archive measurement.

| Measurement | Baseline | Candidate | Reduction |
|---|---:|---:|---:|
| Files | 126 | 80 | 46 |
| Compressed bytes | 1,455,892 | 1,330,186 | 125,706 |
| Unpacked bytes | 3,852,776 | 3,359,831 | 492,945 |

## Executed checks

- Focused groups passed: 21 artifact/build checks, 19 package checks, 76 page and
  adjacent checks, 17 Client configuration checks, 19 DOM wiring checks and four
  task-definition package checks. These groups overlap the comprehensive suite.
- The first comprehensive run passed 531 tests and failed one obsolete assertion
  requiring packaged source. After changing it to require runtime artifacts and
  exclude source, the full `npm run verify` rerun passed **532 tests, 0 failed,
  0 cancelled, 0 skipped**. Go regressions, seven strict TypeScript compiler faces
  and 13 Client build contracts passed. The Go worker command package has no
  direct test files; process behavior is covered by the process tests and fixture.
- Build, check, rebuild and missing-intermediate-output rebuild produced identical
  Client bundles. Building preserved the separate check record.
- A tracked-file-only copy with no local tasks installed locked dependencies
  offline, built, passed strict checks and five infrastructure checks. Its 53
  runtime artifacts matched the candidate byte for byte.
- Actual installation without development dependencies or task data passed plain
  Node loading, registration and disposal of six tools and seven routes. The
  installed-package test independently consumed public types without source.
  Archive checks excluded source, development materials, task data and caches.
- **25 Windows target Host checks** passed with the actual target Cordis and
  subprocess provider under Windows Node 22.23.2. They covered managed workers,
  task isolation, waits, release, evidence invalidation, bounded artifact reads,
  snapshot races and complete large-detail continuation. The 16,001-event
  projection took approximately 467 ms; its full detail was 19,695,394 bytes.
  Timing is an observation rather than a CI threshold.
- **11 target Electron page fixture cases** passed: add/modify success, partial
  failure, stale results, duplicate requests, wrong tab, redirect, oversized
  response, revocation and idle timeout. File assignment remained single-use,
  final submission was rejected and observer cleanup was checked. These are
  isolated synthetic pages, not real website acceptance.
- The clean fixed target matched all 12,637 retained artifact hashes. The
  restarted Desktop loaded the matching Host and served Client with Electron
  44.7.0, Host Node 24.21.0, Desktop bridge v1 and Browser Flow v3. An
  uninstrumented renderer reload retained one owned style and no page errors.
- Two normal Desktop Agent Sessions each logged six calls covering a user wait,
  original detail, expected extreme-offset refusal, task view, graph detail and
  projection-bound continuation. Goals and private markers remained isolated;
  neither page control nor file selection was authorized by these checks.

The earlier 96-case UI matrix remains attached to its original candidate and was
not rerun. The first comprehensive failure and subsequent successful run are
retained separately. All 93 selected historical receipts and 12 protected tracked
files retained their original bytes. Private receipts bind artifact inventories,
actual process identity, configuration, archive and Session logs. Public files,
generated artifacts, native binaries, nested archives and newly reachable Git
objects are checked for private paths and credentials.

## Runtime identity

| Artifact | SHA-256 |
|---|---|
| Host entry | `b0533b77d49d47438fb454335d71bfd5a81474f45d21ca263fb8590668ff162b` |
| Host tools | `1e13a8a3d2a42a62575658f5a93bc84d3833c71f667f11241d5ddf3074fffe8e` |
| Client bundle | `a1813ce3c11f9c489130c2112b9ba2bf945000c6024438e2d22733a7b39107a8` |
| Page programs | `5845eb1cd9ddfa4cf36ae47d3cea710a3252c5a16fe5f8e3f4625dfa2222a425` |
| Page declaration | `a4f89455264072e7a4b540801edc08ba10b43e97ac8ddd584c6f4288eb529137` |
| Windows Go worker | `71aa4ec469d751914ca3b6cbce23ef0578e3df9b634a743d31b8be8631e16b07` |

## Separate acceptance

This qualifies the agreed internal and runtime-package simplifications. It does
not assert that every possible redundancy has been removed. Harness source,
six tools, seven routes, Browser Flow v3, Desktop bridge v1, journal v1 and Go
responsibilities remain unchanged. See the [distribution upgrade guide](../upgrade-guide/v0.1.0/simplification/guide.md).

Real login, manual page authorization/revocation, table save/readback, website
navigation and business import remain **NOT_RUN**. BF0, BF1 and real business
acceptance are separate. Delivery is local additive commits only, without a
push, pull request or remote branch change.
