# Rebuild Host and Client for the Go graph kernel

The graph worker now uses internal protocol v2 and kernel v3. Rebuild and reload the
Host, Client and packaged worker together; v1 workers are rejected. Browser Flow
v3, Desktop bridge v1 and journal v1 stay compatible.

Graph and digest detail continuations must send the `projectionId` returned by
the first read when `offset` is nonzero. Restart from zero after a projection
change. `graphMaxDetailBytes` defaults to 32 MiB and must be at least the frame
limit. The existing setting now caps every canonical task detail, including raw
assets, goals, criteria, waits and instruction snapshots. This adds a capacity
limit to raw details; reduce their size or increase the explicit setting when
`detail_capacity` is reported. The configuration name and accepted range stay
compatible. A missing graph never changes permissions or business facts.

Continuation offsets still count JavaScript characters. All offsets above
`graphMaxDetailBytes` are rejected before graph work or evidence reads, at both
tool and Store entrypoints. Graph and digest offsets above the known length of the
same projection and reference also fail early. Unknown graph lengths are checked
after detail validation and before evidence verification. Within-capacity raw
offsets still require proof verification and an actual length check. Every
canonical Host detail JSON obeys the UTF-8 capacity. `offset === totalChars`
returns an empty completed piece; valid continuations above two million characters
remain supported within the configured capacity.

Cancellation and revision report their committed journal result immediately.
Pending or failed worker retirement appears separately at
`active_context.graph.cleanup`; termination grace controls escalation, not an
exit-observation timeout.

Reads arriving during worker retirement wait for confirmed exit within their
original request deadline. Per-task acquisition and RPC queues use `queueLimit`;
other tasks retain independent queues. Cancelling or timing out a read does not
cancel managed exit observation or free unconfirmed process capacity. Failed exit
observation remains a separate cleanup failure; an already sent RPC is never retried.

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

Task fact reads verify originals after graph work. Within each request, shared
references reuse initially verified bytes; immediately before publishing facts,
every unique original is read and hashed again even when its metadata is unchanged.
An unchanged original requires at most two complete reads per request. Changed or
unreadable originals invalidate every dependent proof. This verifies content at
the final read, without promising an atomic filesystem transaction or caching
proof validity across requests.

Each original read allocates and reads at most its initial stat size plus one
sentinel byte, with a maximum allocation of 16,000,001 bytes. Growing and truncated
files are rejected without reading to EOF. New proof readback uses the same bounded
entry, including the 16,000,000-byte original limit. File identity and digest checks
still apply to both verification phases. This bounds each file read, not total
Host memory across concurrent requests or retained proof assets.

Invalid duplicate receipts do not change the unknown-write block. Failed task
creation cleans only an exclusively allocated, confirmed-unregistered directory;
uncertain registration or cleanup preserves history and refuses repeated creation
for that Session until storage is corrected and the Session reopened.
