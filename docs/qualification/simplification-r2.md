# Simplification review and delivery correction

Date: 2026-10-22. Review baseline:
`f18dc8fec8ed37f1b67057789254f38a5247b9d3`. Test repair: `fa69af6`.
The runtime remains the candidate qualified in the
[original record](simplification.md); this revision changes tests and documentation.

## Findings

| Finding | Disposition | Evidence |
|---|---|---|
| Missing generated page metadata | Repaired | A fresh copy reported ENOENT; missing metadata and HTML fixtures now name the artifact and its preparation command |
| Missing typecheck cache directory | Not reproduced; no script change | TypeScript 6.0.3 passed both Client-only and complete typechecking in independent copies initially lacking `.cache/` |
| Local-only delivery statement | Corrected by this revision | The original six simplification commits were subsequently pushed and published through existing PR #2 |

The original record's delivery sentence was left without a phase qualification
when it was published. It describes completion of the local-commit stage, not
the subsequent publication. Following authorization, the six commits were pushed
to `refactor/plugin-simplification` and published in
[PR #2](https://github.com/Negentropy-Laby/dsh-browser-flow/pull/2), targeting
`master`. This review repair continues through that PR. The original record
retains its complete bytes; this revision supersedes its delivery description.

## Current review checks

- Four permanent missing-input cases failed before repair. With the repaired
  reader, the page-program test file passed **10 tests, 0 failed, 0 cancelled,
  0 skipped**, including preservation of non-ENOENT read errors.
- A tracked-file copy with no `.cache/` produced two expected failures identifying
  missing generated inputs: **8 passed, 2 failed**. Both failures provided their
  preparation commands. No implicit build or cache directory creation occurred.
- After running only `node --import tsx/esm scripts/build-page.ts` and
  `npm run build:fixtures`, the same copy passed all **10 tests**, with no failures,
  cancellations or skips. Its runtime artifacts matched the baseline bytes.
- Three separate deliberately damaged inputs were rejected: an incorrect metadata
  digest, malformed metadata JSON and generated HTML missing its script. None was
  automatically repaired. These failures are retained as negative controls, not
  reported as successful ordinary test runs.
- Client-only typechecking and `npm run typecheck` passed in two other copies
  initially lacking `.cache/`. The complete command checked all seven compiler
  faces. The locked compiler was TypeScript **6.0.3**, running on Node **24.18.1**;
  it created the incremental-record directories. No directory initialization or
  compiler configuration change was required.
- All **53 runtime artifacts**, package manifests, product sources, build scripts
  and the original qualification record retained their baseline bytes. All **133
  selected prior private receipts** also matched their retained digests.

The test adds actionable diagnostics only for missing generated inputs. Other
read failures propagate unchanged. Digest, declaration, AST, page-safety and
serialization checks remain in place. No skipped checks, implicit rebuild,
tracked metadata or general test framework was added. See the
[single-file preparation instructions](../testing.md#run-the-page-program-test-by-itself).

## Retained runtime evidence

The original comprehensive **532-test** run, installation checks, **25 Windows
Host checks**, **11 Electron fixture cases** and two ordinary Agent isolation
runs remain attributed to the original runtime candidate. They were not rerun
for this test/documentation repair. Their artifact identities and detailed
receipts remain unchanged; they are not new executions for this revision.

Public-file and newly reachable-history inspection accompanies publication;
raw test output and local identities stay in ignored evidence storage. Remote
checks are reported separately on PR #2. This revision neither adds a PR nor
establishes a merge or release.

Real login, manual page authorization/revocation, table save/readback, website
navigation and business import remain **NOT_RUN**. BF0, BF1 and real business
acceptance remain separate.
