# Testing and private receipts

Run `npm run build` to emit the Host, Client and Windows x64 Go helper.
The build requires Go 1.26.5 and the declared local TypeScript development dependency.
`npm run typecheck` checks both compiler faces; `npm run verify` also runs Go and
plugin tests. Source tests and development scripts use the declared `tsx/esm`
loader; package loading tests use plain Node. Read the output for skips before claiming coverage.

## Host inputs

`DSH_CHECKOUT` selects a built Harness checkout for Host loadability tests. Without
it the scripts look for a sibling `deepseek-harness` directory. `DSH_TSC` can explicitly select
the TypeScript compiler entry; absence is a failure, not a successful skip. These values are private environment configuration;
no contributor's checkout or installation path is committed.

To test an installed Host, provide its application archive explicitly:

```text
node scripts/extract-installed-host.mjs <app.asar> [private-output-directory]
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

The synthetic Electron fixture (`tests/import-desktop-fixture.mjs`) accepts an
owned Desktop start specification and an output receipt path. Keep both private.
It checks native file and response behavior in a network-isolated page and reads
runtime versions from the connected instance. It does not establish a logged-in
website result or a normal Agent business run.

Keep real task definitions, inputs, machine paths, process identities, transcripts
and raw receipts in the private task store or ignored evidence directories.
Synthetic tests and code validators can be public; local run artifacts cannot.
Before publishing, inspect staged files, the actual package archive and reachable
Git history. A clean working tree or an ignore rule alone does not establish this.

## Go graph qualification

`npm run verify` builds the production Windows helper and an owned host-platform
helper used only by synthetic source tests. It runs the Go tests, both compiler
faces and plugin regressions. The source tests use explicit per-test process
providers; the production adapter always consumes the mounted Host subprocess
service. No test helper is a runtime fallback.

On Windows x64, run the target-artifact fixture with explicit inputs:

```text
node tests/target-graph-host.mjs <target-checkout> <private-receipt> [git-executable]
```

It requires the fixed target revision and a clean tracked source tree. It checks
actual managed Go processes, two isolated synthetic tasks, waits, release,
crash-without-replay, reconstruction and quiescent disposal. Its synthetic page
inventory is a fixture; it does not prove manual authorization or website
acceptance. Normal Agent runs and actual Desktop identities must be recorded
separately in private evidence. Preserve failed receipts alongside later runs.
