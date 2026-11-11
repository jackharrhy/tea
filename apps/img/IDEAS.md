# Next slices

## Shared image workflows

- Keep Ref's plain upload/view boards useful. An editable item can opt into an
  image recipe without turning every board into an editor.
- Separate immutable source assets, processing recipes, board placement, and
  export definitions. Resizing a card must not resize its output pixels.
- Let recipes include reusable macros with exposed parameters and per-use
  overrides. Batch operations apply one recipe or shared parameter set to many
  sources; they do not require flattening the board into a giant bitmap.
- Extract a host-independent Rust processing crate when building Ref's editing
  consumer. Compile that crate to WASM for a browser worker and use it natively
  from Img. Keep Rune widgets, dialogs, file access, clocks, and host scheduling
  outside the processing API. Evaluate Rune's lower-level rendering pieces
  separately from the pixel-processing engine.
- Define versioned recipes before adding graph editing. Keep single-image
  stacks convenient; allow graphs where branching and composition are useful.
- Export bundles select named recipe outputs. PNG collections, GIFs, and a
  GoldSrc WAD are separate output targets; WAD import is not an initial goal.
- Preserve relative source links for local projects and let web hosts resolve
  asset IDs. Add an explicit collect/export action for portable project files.

## Editing

- Aspect-ratio lock, percent resize, and nearest-neighbor resize for pixel art.
- Direct per-frame duration editing and painting.
- Project recipe files with source-path relinking; undo/redo and versioned clipboard transfers are implemented.
- Keyboard reordering; card duplication is implemented.
- Canvas manipulation for image overlays and multi-selection.

## Preview and export

- Continuous zoom and pointer-based panning.
- Preview mode honoring finite repeats.
- Optimized delta-frame export; show output size before saving.
- Side-by-side source/final comparison and per-step processing time.

## Reliability and distribution

- Signing and notarization for the macOS app bundle.
- Automated native dialog/export checks on macOS and Linux desktop portals.
- More checkpoints where profiling supports them; cancellation and progress for long jobs.
- Show tracked memory estimates before an operation runs.
- Cache display-sized playback pixels under a separate budget; reduce full UI rebuilds during playback.
- Additional malformed-GIF fixtures, fuzzing, and peak-memory tests.
- Evaluate FFmpeg for video import/export and filters where it improves capability or throughput.

Choose the best implementation per operation; simple frame/pixel edits run directly in Rust. Optional external tools should remain explicit, fixed operations with no shell command interpolation.
