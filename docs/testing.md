# Testing and private receipts

Run `npm run build` to emit the Host, Client and Windows x64 Go helper.
The build requires Go 1.26.5 and the declared local TypeScript development dependency.
`npm run typecheck` checks all seven compiler faces; `npm run verify` also runs Go and
plugin tests. Source tests and development scripts use the declared `tsx/esm`
loader; package loading tests use plain Node. Read the output for skips before claiming coverage.

## Host inputs

`DSH_CHECKOUT` selects a built Harness checkout for Host loadability tests. Without
it the scripts look for a sibling `deepseek-harness` directory. `DSH_TSC` can explicitly select
the TypeScript compiler entry; absence is a failure, not a successful skip. These values are private environment configuration;
no contributor's checkout or installation path is committed.

To test an installed Host, provide its application archive explicitly:

```text
node --import tsx/esm scripts/extract-installed-host.ts <app.asar> [private-output-directory]
```

`DSH_BF_APP_ASAR` is an alternative to the first argument. The default output is
the ignored `.evidence/installed-host/` directory. The installed-Host tests use
that extraction and skip with a reason when it is absent. Extraction records the
selected archive's build identity; Electron's version is read from the adjacent
installation when available, otherwise recorded as unknown.

The optional `npm run smoke:live` needs `DSH_BF_SMOKE_ELECTRON` and
`DSH_BF_SMOKE_CLI` set to the existing absolute paths of the installed Electron
binary and its carrier CLI entry. No installation path is assumed. This check
uses an isolated profile and writes its receipt to ignored `.evidence/`.

## Evidence scope

The synthetic Electron fixture (`tests/import-desktop-fixture.ts`) accepts an
owned Desktop start specification and an output receipt path. Keep both private.
It checks native file and response behavior in a network-isolated page and reads
runtime versions from the connected instance. It does not establish a logged-in
website result or a normal Agent business run.

Keep real task definitions, inputs, machine paths, process identities, transcripts
and raw receipts in the private task store or ignored evidence directories.
Synthetic tests and code validators can be public; local run artifacts cannot.
Before publishing, inspect staged files, the actual package archive and reachable
Git history. A clean working tree or an ignore rule alone does not establish this.

The [simplification review revision](qualification/simplification-r2.md) separates
the current test checks from retained runtime evidence and records the subsequent
PR #2 publication of the original local commits.

Fixed page programs are compiled with a DOM-only TypeScript program before they
are serialized into the Host/Client data module. Run `npm run build:fixtures` to
assemble the three static HTML fixtures with their compiled TypeScript behavior
under `.cache/fixtures/`. The native import fixture reads that generated page.
Tracked HTML contains no inline executable script. Fixture generation is for
synthetic checks and does not establish real website acceptance.

Page-program verification metadata is generated under `.cache/page-programs.json`.
The installed package reads the generated JavaScript and carries its paired
declarations; verification metadata is not a runtime dependency. Client-only
import-program builders are bundled into the Client rather than emitted as
unused Host modules.

### Run the page-program test by itself

After installing the locked development dependencies, prepare both generated
inputs before running the test directly or through an editor:

```sh
node --import tsx/esm scripts/build-page.ts
npm run build:fixtures
node --import tsx/esm --test tests/page-program-generation.test.ts
```

This preparation requires neither Go nor Desktop. `npm run build` alone does
not assemble the HTML fixtures. Missing generated inputs fail with the relevant
preparation command; the test does not build them, skip checks or repair stale
inputs. `npm test` and `npm run verify` already prepare both inputs.

With the locked TypeScript 6.0.3 compiler, `npm run typecheck` can run before any
build and without an existing `.cache/` directory. The compiler creates its
incremental-record directories.

## Go graph qualification

`npm run verify` builds the production Windows helper and an owned host-platform
helper used only by synthetic source tests. It runs the Go tests, all seven compiler
faces and plugin regressions. The source tests use explicit per-test process
providers; the production adapter always consumes the mounted Host subprocess
service. No test helper is a runtime fallback.

On Windows x64, run the target-artifact fixture with explicit inputs:

```text
node --import tsx/esm tests/target-graph-host.ts <target-checkout> <private-receipt> [git-executable]
```

It requires the fixed target revision and a clean tracked source tree. It checks
actual managed Go processes, two isolated synthetic tasks, waits, release,
crash-without-replay, reconstruction and quiescent disposal. It also checks full
detail transfer over 64 KiB frames and over the default 8 MiB frame, using a
16,001-event projection with the default request deadline. Its synthetic page
inventory is a fixture; it does not prove manual authorization or website
acceptance. Normal Agent runs and actual Desktop identities must be recorded
separately in private evidence. Preserve failed receipts alongside later runs.

The target fixture consumes built Host and worker modules. It waits for actual idle
exit when acquisition expires before the first RPC, and for owned retirement before
serving a same-scope replacement. It checks cheap scoped offset rejection, exact-end
continuation and two-phase verification of private synthetic originals. A fixed
metadata provider isolates changed-content rejection; it does not demonstrate a
metadata-preserving attack on a real volume. Run it after building the candidate;
do not mix source and built class identities.

The fixture also grows real Windows files after stat and between short reads,
measuring buffer capacity and cumulative reads against the original size plus one.
It checks original detail capacity and offset rejection before evidence I/O. A
barrier on a real synchronized append exercises the gap between the evidence
guard and the outer detail continuation; inconsistent journal versions must be
rejected. These checks do not use an RSS timing assertion or prove a bound on
total Host memory. Evidence-original reads retain their 16,000,000-byte limit.

Compiler checks include the test fixtures. Synthetic JSON assertions narrow dynamic
page and IPC results; intentional static counterexamples use local, documented
`@ts-expect-error` lines. No compiler face disables strict checking for fixtures.
