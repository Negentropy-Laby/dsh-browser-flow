# TypeScript source migration

Development scripts and source tests run with the package's declared `tsx/esm`
loader. Run package commands through npm after installing development dependencies.
Direct script invocations use `node --import tsx/esm scripts/<name>.ts`.

The Host entry and public package exports continue to load compiled JavaScript
from `lib/`. Installed profiles need neither tsx nor a TypeScript compiler.
Rebuild and reload the Host and Client together after a source update.

Source filenames change from `.js` or `.mjs` to `.ts` in reviewed batches. Update
direct development imports to the owning TypeScript source; published package
subpaths keep their existing names. Generated declarations describe the narrowed
internal types. Wire protocol v3, Desktop bridge v1 and task journal format v1
retain their existing parsing and persistence rules.

Shared scope, configuration, wait and wire modules now expose TypeScript types.
Handshake and command parsers retain their existing runtime checks and return
canonical identities. Source test discovery includes both migration generations
until the final JavaScript source batch has been removed.

Optional terminal-result diagnostics must be objects with a bounded string
message when a message is supplied. This matches the paired Client output;
malformed diagnostics are refused before settling a command. Authorization calls
made after unload return an HTTP refusal and cannot create control.

Client compilation emits private intermediate JavaScript before the existing
bundle assembly. Build cleanup owns only its output directories and does not
remove local tasks, inputs or historical receipts.
