# Testing and private receipts

Run `npm run build` to rebuild the Client and check its bundled page programs.
`npm run typecheck` checks the JSDoc-typed sources; `npm run verify` also runs the
plugin tests. Read the output for skips before claiming coverage.

## Host inputs

`DSH_CHECKOUT` selects a built Harness checkout for Host loadability tests. Without
it the scripts look for a sibling `deepseek-harness` directory. `DSH_TSC` can select
the TypeScript compiler entry. These values are private environment configuration;
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
