# img

A local image and GIF editor for Windows, macOS, and Linux, written in Rust with [Rune](https://github.com/anomalyco/rune). Stack effects, preview a step, and export the result. All 66 operations run locally without external processing tools.

## Run

Install Rust through [rustup](https://rustup.rs). The repo pins the toolchain and dependencies; Rune is still pre-release.

- Windows: install Visual Studio Build Tools with the Desktop development with C++ workload. Put `%USERPROFILE%\.cargo\bin` on PATH. Rune currently reports native menus unsupported on Windows.
- macOS: install Apple's command-line tools with `xcode-select --install`.
- Ubuntu/Debian:

```sh
sudo apt install build-essential pkg-config libx11-dev libxkbcommon-dev libwayland-dev libegl1-mesa-dev libvulkan1 mesa-vulkan-drivers
```

```sh
git clone git@github.com:jackharrhy/harrhy.git
cd harrhy/apps/img
cargo run --locked --release -- samples/hummingbird.gif
```

- Omit the GIF path to start empty.
- macOS app bundle: run `scripts/build-macos-app.sh`, then open `artifacts/img.app`. It is unsigned and not notarized.
- Linux needs an X11 or Wayland desktop and Vulkan drivers. If file dialogs fail, install `xdg-desktop-portal` and your desktop's portal backend.

## Use

- Add operations below the stack. Drag their grips to reorder; the eye icon bypasses an effect. See the [operation reference](OPERATIONS.md).
- The monitor button chooses the preview. Expanding or editing another card keeps that selection. Export always saves the final result.
- Click a number to type, or drag it to adjust. Field edits apply after a short pause or on blur; Enter applies immediately. Shift-drag gives finer control.
- Use preview handles to move text, rotate, crop, resize, or adjust the canvas. Escape cancels a drag. Show frames lets you inspect individual frames.
- Captions support bundled and installed fonts. The eyedropper samples the screen on macOS and the preview on Linux.
- Undo/redo: Cmd+Z / Shift+Cmd+Z. Cmd+D duplicates; Cmd+C/X/V copies, cuts, and pastes. Use Ctrl on Linux.
- Replacing the GIF keeps your effects and settings. The original file is never modified.

## Harrhy workspace

From the Harrhy root, `npm run img:dev -- samples/hummingbird.gif` opens the sample.
`npm run img:check` runs formatting, release tests, and Clippy. These commands
require Cargo on PATH and do not require installing the JavaScript dependencies.
Paths passed to the app are relative to `apps/img`. Rust dependencies and the
toolchain remain pinned in this app; integration tests live in `__tests__/`.
GitHub checks cache Cargo downloads and compilation outputs by runner, pinned
manifest/lock/toolchain, and source inputs. Cargo still executes the complete
release test and Clippy commands on cache hits; no check is skipped.

The native Rune UI stays in this app. A shared image-processing or WASM package
can be extracted when Ref consumes it; no browser editing or WAD export is
implemented by this import. The original checkout is preserved.

## Limits and development

- Up to 64 operations, 1,000 frames, 4,096 pixels per side, and 64 MiB input files. Each decoded animation is limited to 256 MiB; tracked frame buffers have a 1 GiB budget, separate from total process memory.
- GIF export allows up to 256 colors per frame and binary transparency. Use Matte background to blend partial transparency into a chosen color.
- Project files and optimized delta-frame export are still on the [to-do list](IDEAS.md).

```sh
cargo fmt --check
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
```

GPU screenshots: `scripts/render-smoke.sh` after a release build. [Font licenses](assets/fonts/README.md) · [Sample attribution](samples/README.md)
