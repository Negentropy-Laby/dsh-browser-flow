# Runtime package contents

Installed archives contain compiled Host and Client code, the Windows Go worker,
required declarations, user documentation and license records. Sources, test
instructions and qualification reports remain in the repository rather than
being distributed in the runtime archive. Use a source checkout for development.

Public package subpaths, signatures, result fields and declared state fields are
unchanged. Page-program type resolution uses the packaged declaration beside the
generated JavaScript. Installation needs neither local tasks nor development
toolchains. The source lockfile and dependency versions are unchanged.

Build verification metadata lives in the ignored cache and is not a runtime
input. Client-only import-program builders remain in the Client bundle; unused
Host copies are removed. Rebuild and reload matching Host and Client artifacts
after updating a linked source installation.

The six tools, seven routes, Browser Flow v3, Desktop bridge v1, task journal v1
and Go protocol remain compatible. This change does not establish real website
or business acceptance.
