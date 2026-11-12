use image::RgbaImage;
use img::{Animation, Card, Frame, Operation};
#[test]
fn negate_real_multiframe_gif_without_exhausting_cache() {
    let source = std::sync::Arc::new(
        Animation::load(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("samples/hummingbird.gif")
                .as_path(),
        )
        .unwrap(),
    );
    let outputs = img::process(
        source.clone(),
        &[Card {
            id: 1,
            enabled: true,
            operation: Operation::Negate,
        }],
    )
    .expect("Negate must work on the bundled 45-frame sample");
    assert_eq!(outputs[0].repeat, source.repeat);
    assert_eq!(outputs[0].frames.len(), source.frames.len());
    for (actual, original) in outputs[0].frames.iter().zip(&source.frames) {
        assert_eq!(actual.delay_ms, original.delay_ms);
        assert_eq!(actual.pixels.dimensions(), original.pixels.dimensions());
        for (a, b) in actual.pixels.pixels().zip(original.pixels.pixels()) {
            assert_eq!(a.0, [255 - b[0], 255 - b[1], 255 - b[2], b[3]]);
        }
    }
}

#[test]
fn negate_twice_restores_exact_rgba_including_partial_alpha() {
    let source = std::sync::Arc::new(Animation {
        frames: vec![Frame {
            pixels: RgbaImage::from_raw(
                3,
                1,
                vec![12, 70, 231, 0, 0, 128, 255, 127, 255, 0, 1, 255],
            )
            .unwrap()
            .into(),
            delay_ms: 73,
        }],
        repeat: gif::Repeat::Finite(0),
    });
    let cards = [1, 2].map(|id| Card {
        id,
        enabled: true,
        operation: Operation::Negate,
    });
    let outputs = img::process(source.clone(), &cards).unwrap();
    for (actual, original) in outputs[0].frames[0]
        .pixels
        .pixels()
        .zip(source.frames[0].pixels.pixels())
    {
        assert_eq!(
            actual.0,
            [
                255 - original[0],
                255 - original[1],
                255 - original[2],
                original[3]
            ]
        );
    }
    assert_eq!(outputs[1].frames[0].pixels, source.frames[0].pixels);
    assert_eq!(outputs[1].frames[0].delay_ms, 73);
    assert_eq!(outputs[1].repeat, gif::Repeat::Finite(0));
}
