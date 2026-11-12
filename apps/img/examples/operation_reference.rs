use img::{Operation, ParameterKind};
fn main() {
    println!(
        "# Operations\n\n{} operations; up to 64 cards in one stack. Use **Add operation** to search by name or category. Valid field edits apply after a short pause or on blur; Enter applies immediately. Captions support Shift+Enter for new lines. Defaults for crop, frame ranges, fades, and captions adapt to the current animation.\n",
        Operation::catalog().len()
    );
    println!(
        "Generated from the same registry as the editor: `cargo run --locked --example operation_reference > OPERATIONS.md`. Numeric ranges below are inclusive; crop rectangles and frame ranges must also fit their input. Operations can fail before rendering when dimensions, frames, delays, or retained pixels would exceed the limits in README.\n"
    );
    let mut operations = Operation::catalog();
    operations.sort_by_key(|op| op.category());
    let mut category = "";
    for op in operations {
        if category != op.category() {
            category = op.category();
            println!("## {category}\n\n| Operation | Parameters | Behavior |\n| --- | --- | --- |");
        }
        let parameters: Vec<_> = op
            .parameters()
            .into_iter()
            .map(|p| {
                if p.kind == ParameterKind::Number {
                    format!("{}: {}–{} (default {})", p.label, p.min, p.max, p.value)
                } else {
                    format!("{}: up to {} characters", p.label, p.max)
                }
            })
            .collect();
        println!(
            "| {} | {} | {} |",
            op.name(),
            if parameters.is_empty() {
                "—".into()
            } else {
                parameters.join("; ")
            },
            op.description()
        );
    }
    println!(
        "\n## Export and overlays\n\nGIF has binary transparency. Use **Matte background** to bake partial opacity, antialiased text, or rounded edges into a background color before exporting. Otherwise nonzero alpha becomes opaque. **Limit palette** computes one palette across the animation; GIF export still writes a local palette for each frame.\n\nOverlays accept PNG, JPEG, and GIF files. An empty path or zero opacity bypasses compositing. Width 0 uses original dimensions; other widths preserve aspect ratio. Animated overlays repeat over one source cycle, merging both sets of frame boundaries. Zero-delay frames use 10 ms during this synchronization. The source loop setting is retained.\n\nCaptions support bundled and installed fonts; see assets/fonts/README.md for the bundled font licenses. Text is rasterized locally with kerning and line breaks; complex script shaping is not implemented.\n\n## Research\n\nThe catalog was informed by the tools offered in [Ezgif](https://ezgif.com/effects), the [ImageMagick operator reference](https://imagemagick.org/command-line-options/), and [Gifsicle's manual](https://www.lcdf.org/gifsicle/man.html). Implementations here run in Rust and are not intended to produce identical pixels to those tools."
    );
}
