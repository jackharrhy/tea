# Img workspace

Read Harrhy's root AGENTS.md and this app's README before editing. Img is a native
Rust/Rune application, not a Remix web app. Its Cargo manifest, lockfile, toolchain,
assets, operations, and native UI belong here. Keep the npm scripts as small
entry points into Cargo.

Run `npm run img:check` from Harrhy's root. Rust integration tests and GPU script
fixtures live in `__tests__/`; explicit Cargo test targets preserve discovery.
Keep existing inline unit tests beside their private implementation. New
separate test modules go under adjacent `__tests__/` directories.

Preserve fonts and sample attribution. Do not check in `target/`, `.tmp/`, or
`artifacts/`. Ref remains usable as a plain image/link board. Extract processing
code into a package when implementing the actual native and browser consumers,
not merely to anticipate a WASM integration.
