# TypeScript source migration

Development scripts and source tests run with the package's declared `tsx/esm`
loader. Run package commands through npm after installing development dependencies.
Direct script invocations use `node --import tsx/esm scripts/<name>.ts`.

The Host entry and public package exports continue to load compiled JavaScript
from `lib/`. Installed profiles need neither tsx nor a TypeScript compiler.
Rebuild and reload the Host and Client together after a source update.

Handwritten source filenames are `.ts`. Update
direct development imports to the owning TypeScript source; published package
subpaths keep their existing names. Generated declarations describe the narrowed
internal types. Wire protocol v3, Desktop bridge v1 and task journal format v1
retain their existing parsing and persistence rules.

Shared scope, configuration, wait and wire modules now expose TypeScript types.
Handshake and command parsers retain their existing runtime checks and return
canonical identities. Source test discovery selects `.test.ts` files. Every compiler face rejects
JavaScript sources. Generated JavaScript remains the installed runtime.

Optional terminal-result diagnostics must be objects with a bounded string
message when a message is supplied. This matches the paired Client output;
malformed diagnostics are refused before settling a command. Authorization calls
made after unload return an HTTP refusal and cannot create control.

Client compilation emits private intermediate JavaScript before the existing
bundle assembly. Build cleanup owns only its output directories and does not
remove local tasks, inputs or historical receipts.

Fixed page execution now comes from a DOM-only TypeScript compiler face. The
build serializes only compiler-emitted functions into a generated package data
module. Host and Client consume the same module; neither installation nor page
execution invokes a TypeScript loader. Rebuild both artifacts before reloading.
The passive import observer retains its scoped XHR exception; other fixed
programs retain the existing storage, credential and request restrictions.

Synthetic HTML is static in the source tree. `npm run build:fixtures` assembles
its compiled behavior under `.cache/fixtures/`; use those generated pages for
local fixture execution. Historical receipts still refer to their own candidate.

The Client sources are TypeScript and compile before bundle assembly. Panel
responses are decoded at the HTTP JSON boundary, including task ownership and
command operations. The existing poll envelope and protocol v3 are unchanged.
Reload Host and Client together after replacing the generated artifacts.

Tests, diagnostics and Electron fixture programs now use checked TypeScript.
Child source entrypoints explicitly load this package's `tsx/esm`; installed
package probes use generated JavaScript under plain Node. Fixture serialization
rejects captured compiler helpers. The Host, Client, DOM programs, scripts,
tests, DOM fixtures and Electron programs each have a compiler face.

The unused root `lib/pagecode.js` copy is removed. The public `./pagecode` export
continues to resolve to the generated `lib/host/pagecode.js` entry.

Fixed-program inputs are separate from DOM runtime state. Node consumers can
check the public Host and page-builder declarations with an ES-only library
configuration; installing the plugin does not add a DOM type requirement.

Optional policy kinds, lease counts and file-confirmation flags retain their
stated JSON types; malformed optional fields are refused. Tool-layer forms also
install compiler-emitted handlers. Wait fixtures use explicit readiness events
after the page observer is installed.

Find results reject non-object page matches before selecting an element; the
public result declaration carries the validated record type.
