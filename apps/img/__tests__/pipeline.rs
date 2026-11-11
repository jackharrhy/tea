use img::{Animation, Frame};

use image::{Rgba, RgbaImage};

#[test]
fn gif_roundtrip_preserves_pixels_delays_and_loop() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("test.gif");
    let source = Animation {
        frames: vec![
            Frame {
                pixels: RgbaImage::from_pixel(4, 3, Rgba([255, 0, 0, 255])).into(),
                delay_ms: 70,
            },
            Frame {
                pixels: RgbaImage::from_pixel(4, 3, Rgba([0, 0, 0, 0])).into(),
                delay_ms: 130,
            },
        ],
        repeat: gif::Repeat::Finite(3),
    };
    source.save(&path).unwrap();
    let decoded = Animation::load(&path).unwrap();
    assert_eq!(decoded.repeat, source.repeat);
    assert_eq!(decoded.frames.len(), 2);
    for (a, b) in source.frames.iter().zip(&decoded.frames) {
        assert_eq!(a.delay_ms, b.delay_ms);
        assert_eq!(a.pixels, b.pixels);
    }
}
