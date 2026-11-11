use image::Rgba;
use img::{Animation, Card, Operation};
use std::{borrow::Cow, fs::File};

#[test]
fn decoder_composites_offsets_background_and_previous_disposal() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("disposal.gif");
    {
        let mut encoder = gif::Encoder::new(
            File::create(&path).unwrap(),
            3,
            1,
            &[0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255],
        )
        .unwrap();
        for (left, width, buffer, dispose) in [
            (0, 3, vec![1, 1, 1], gif::DisposalMethod::Keep),
            (1, 1, vec![2], gif::DisposalMethod::Previous),
            (2, 1, vec![3], gif::DisposalMethod::Background),
            (0, 1, vec![2], gif::DisposalMethod::Keep),
        ] {
            encoder
                .write_frame(&gif::Frame {
                    left,
                    width,
                    height: 1,
                    buffer: Cow::Owned(buffer),
                    dispose,
                    delay: 9,
                    transparent: Some(0),
                    ..Default::default()
                })
                .unwrap();
        }
    }
    let decoded = Animation::load(&path).unwrap();
    let red = Rgba([255, 0, 0, 255]);
    let green = Rgba([0, 255, 0, 255]);
    let blue = Rgba([0, 0, 255, 255]);
    assert_eq!(decoded.repeat, gif::Repeat::Finite(0));
    assert_eq!(decoded.frames[1].pixels.get_pixel(0, 0), &red);
    assert_eq!(decoded.frames[1].pixels.get_pixel(1, 0), &green);
    assert_eq!(decoded.frames[2].pixels.get_pixel(1, 0), &red);
    assert_eq!(decoded.frames[2].pixels.get_pixel(2, 0), &blue);
    assert_eq!(decoded.frames[3].pixels.get_pixel(0, 0), &green);
    assert_eq!(decoded.frames[3].pixels.get_pixel(2, 0).0[3], 0);
    assert!(decoded.frames.iter().all(|f| f.delay_ms == 90));
}

#[test]
fn rejects_corrupt_input_invalid_resize_and_stack_budget() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("bad.gif");
    std::fs::write(&path, b"not a GIF").unwrap();
    assert!(Animation::load(&path).is_err());
    let source = std::sync::Arc::new(Animation {
        frames: vec![img::Frame {
            pixels: image::RgbaImage::new(1, 1).into(),
            delay_ms: 10,
        }],
        repeat: gif::Repeat::Infinite,
    });
    let card = |width, height| Card {
        id: 1,
        enabled: true,
        operation: Operation::Resize { width, height },
    };
    assert!(img::process(source.clone(), &[card(0, 1)]).is_err());
    assert!(img::process(source.clone(), &[card(4097, 1)]).is_err());
    let pixels = std::sync::Arc::new(image::RgbaImage::new(4096, 4096));
    let large = std::sync::Arc::new(Animation {
        frames: vec![
            img::Frame {
                pixels: pixels.clone(),
                delay_ms: 10
            };
            4
        ],
        repeat: gif::Repeat::Infinite,
    });
    let too_many = std::sync::Arc::new(Animation {
        frames: vec![
            img::Frame {
                pixels: pixels.clone(),
                delay_ms: 10
            };
            5
        ],
        repeat: gif::Repeat::Infinite,
    });
    assert!(
        img::process(too_many, &[])
            .unwrap_err()
            .to_string()
            .contains("256 MiB")
    );
    let reversed = img::process(
        large,
        &[img::Card {
            id: 1,
            enabled: true,
            operation: Operation::Reverse,
        }],
    )
    .unwrap();
    assert!(std::sync::Arc::ptr_eq(
        &reversed[0].frames[0].pixels,
        &pixels
    ));
}

#[test]
fn failed_export_does_not_clobber_existing_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("existing.gif");
    std::fs::write(&path, b"keep me").unwrap();
    let invalid = Animation {
        frames: vec![
            img::Frame {
                pixels: image::RgbaImage::new(1, 1).into(),
                delay_ms: 10,
            },
            img::Frame {
                pixels: image::RgbaImage::new(2, 1).into(),
                delay_ms: 10,
            },
        ],
        repeat: gif::Repeat::Infinite,
    };
    assert!(invalid.save(&path).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), b"keep me");
}
