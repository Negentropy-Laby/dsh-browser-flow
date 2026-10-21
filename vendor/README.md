# Runtime writer coordination

`deepseek-ai-dsh-atomic-write-0.2.1-rc.2.tgz` vendors the MIT utility from upstream Harness revision `687f282e8625c6b8d11ff58211a90524be2e4317`, `packages/util/atomic-write`. SHA-256: `2de3a5d8211f988210def8eb84ec3d93c1d20ad4f725c79dcc04e11d945087e1`. The archive contains its license, built JavaScript and declarations. The plugin declares it as a file dependency so installed packages do not depend on a developer's checkout or an unpublished registry version.

Task storage uses its `withFileLock` for one local OS/host namespace. It does not rely on atomic replacement for crash durability; journal and creation records are explicitly synchronized with `FileHandle.sync()`. A separate host/OS marker prevents treating another PID namespace as a dead writer.

The package also declares this one utility in `bundleDependencies`. npm resolves nested file tarballs before extracting their parent during fresh tarball installs; bundling the resolved utility supplies the same pinned bytes at install time. No other extracted Host dependencies are bundled.
