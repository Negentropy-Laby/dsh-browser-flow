# Rebuild Host and Client for the Go graph kernel

The graph worker now uses internal protocol v2 and kernel v3. Rebuild and reload the
Host, Client and packaged worker together; v1 workers are rejected. Browser Flow
v3, Desktop bridge v1 and journal v1 stay compatible.

Graph and digest detail continuations must send the `projectionId` returned by
the first read when `offset` is nonzero. Restart from zero after a projection
change. `graphMaxDetailBytes` defaults to 32 MiB and must be at least the frame
limit; detail capacity errors require reducing task size or increasing this
explicit setting. A missing graph never changes permissions or business facts.

Cancellation and revision report their committed journal result immediately.
Pending or failed worker retirement appears separately at
`active_context.graph.cleanup`; termination grace controls escalation, not an
exit-observation timeout.

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

Kernel v3 uses criterion-specific proof edge IDs and validates recorded edges in replay order. Outer graph continuation IDs include the kernel version; restart at offset zero after upgrading. The raw safe input digest remains the internal RPC binding. No task journal or Browser Flow protocol migration is needed.
