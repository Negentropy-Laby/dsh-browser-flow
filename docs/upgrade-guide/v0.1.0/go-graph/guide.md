# Rebuild Host and Client for the Go graph kernel

The package entry and existing Host export subpaths now resolve to built ESM
under `lib/host`. The new TypeScript adapter is compiled at build time; installed
profiles require neither a TypeScript loader nor a Go toolchain. Windows x64
packages include a verified Go helper. Other platforms can load the six tools
but report graph computation unavailable.

Install from a package containing the rebuilt Host, Client and native manifest,
then restart the owning Desktop profile. Source contributors run `npm ci` and
`npm run build` with Go 1.26.5 before installing their checkout. Runtime does not
download helpers or search PATH. Keep the packaged helper and its manifest paired.

Browser Flow remains protocol v3 and Desktop bridge remains v1. Task journals
remain format v1; unversioned histories stay read-only. Restarting reconstructs
derived graphs and cold digests, without restoring browser control or replaying
commands. Changed inputs invalidate old digest references.

Missing helpers, absent subprocess services, exhausted graph capacity and failed
RPCs appear in `active_context.graph`. They do not validate a task or clear an
unknown write. Obtain a new task view after repairing the component; RPCs and
browser writes are not automatically replayed.
