# Store platform adapter

This project-owned C binding exposes OS file locks, flushes, and file replacement.
All database formats, transactions, history, and recovery live in TypeScript.
There is no database dependency, Python, node-gyp, downloaded header, or code
generator. `api.h` declares the small stable Node-API subset the binding uses.

```sh
bun scripts/build-native.ts
```

Source builds require a C compiler, or an MSVC developer environment on Windows.
The release CLI must embed the resulting `.node` file; it must not require a
compiler on the user's machine. The remote-only client does not load this binding.

Locks are nonblocking OS locks on persistent files. Never unlink those files
while the store is in use. Releasing the returned handle is idempotent, and the
OS releases ownership when a process terminates. A JavaScript finalizer closes
an abandoned handle as a backstop.

macOS file flushes request `F_FULLFSYNC`. Linux uses `fsync`. Windows replacement
uses `MoveFileExW` with replacement and write-through flags; file flushes use
`FlushFileBuffers`. Filesystem and power-loss guarantees require platform testing.
Local macOS tests do not establish Windows or Linux behavior.

Every immutable file and parent directory is synchronized before the staged
head receives the ordering barrier. On macOS this uses `F_BARRIERFSYNC`, with
`F_FULLFSYNC` as the fallback for unsupported filesystems. The engine then
replaces the head, syncs its directory, and requests `F_FULLFSYNC` before
acknowledging. Both ordering and acknowledgement barriers remain required.
[Apple fsync and F_FULLFSYNC contract](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/fsync.2.html)
[Apple storage ordering guidance](https://developer.apple.com/videos/play/wwdc2019/419/)

- [Node-API](https://nodejs.org/api/n-api.html)
- [Bun native addons in executables](https://bun.sh/docs/bundler/executables)
