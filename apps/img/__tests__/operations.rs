use image::{Rgba, RgbaImage};
use img::{Animation, Card, Frame, Operation};
use std::sync::Arc;

fn animation(frames: Vec<(RgbaImage, u32)>) -> Arc<Animation> {
    Arc::new(Animation {
        frames: frames
            .into_iter()
            .map(|(pixels, delay_ms)| Frame {
                pixels: pixels.into(),
                delay_ms,
            })
            .collect(),
        repeat: gif::Repeat::Finite(2),
    })
}
fn solid(color: [u8; 4]) -> Arc<Animation> {
    animation(vec![(RgbaImage::from_pixel(3, 3, Rgba(color)), 70)])
}
fn run(source: &Arc<Animation>, operation: Operation) -> Arc<Animation> {
    img::process(
        source.clone(),
        &[Card {
            id: 1,
            enabled: true,
            operation,
        }],
    )
    .unwrap()
    .remove(0)
}
fn pixel(source: &Arc<Animation>, operation: Operation) -> [u8; 4] {
    run(source, operation).frames[0].pixels.get_pixel(0, 0).0
}
fn sequence() -> Arc<Animation> {
    animation(vec![
        (RgbaImage::from_pixel(4, 2, Rgba([255, 0, 0, 255])), 30),
        (RgbaImage::from_pixel(4, 2, Rgba([0, 255, 0, 255])), 70),
        (RgbaImage::from_pixel(4, 2, Rgba([0, 0, 255, 255])), 110),
    ])
}
fn delays(a: &Animation) -> Vec<u32> {
    a.frames.iter().map(|f| f.delay_ms).collect()
}
fn grid() -> Arc<Animation> {
    animation(vec![(
        RgbaImage::from_fn(4, 2, |x, y| Rgba([(x + 10 * y) as u8, 0, 0, 255])),
        70,
    )])
}

#[test]
fn catalog_ids_names_and_parameter_validation_are_consistent() {
    let source = animation(
        (0..5)
            .map(|i| {
                (
                    RgbaImage::from_fn(24, 16, |x, y| {
                        Rgba([
                            (x * 10) as u8,
                            (y * 16) as u8,
                            (i * 40) as u8,
                            if (x + y) % 11 == 0 { 0 } else { 255 },
                        ])
                    }),
                    40 + i * 10,
                )
            })
            .collect(),
    );
    let mut ids = std::collections::HashSet::new();
    let mut names = std::collections::HashSet::new();
    let catalog = Operation::catalog();
    for original in catalog {
        let op = original.defaults_for(&source);
        assert!(ids.insert(op.id()));
        assert!(names.insert(op.name()));
        let parameters = op.parameters();
        let values: Vec<_> = parameters.iter().map(|p| p.value.clone()).collect();
        assert_eq!(op.with_parameters(&values).unwrap(), op);
        for (index, parameter) in parameters.iter().enumerate() {
            let invalid_values = if parameter.kind == img::ParameterKind::Number {
                vec![
                    "NaN".to_owned(),
                    "inf".into(),
                    (parameter.max + 1.).to_string(),
                    (parameter.min - 1.).to_string(),
                ]
            } else {
                vec!["x".repeat(parameter.max as usize + 1), "bad\0text".into()]
            };
            for value in invalid_values {
                let mut invalid = values.clone();
                invalid[index] = value;
                assert!(
                    op.with_parameters(&invalid).is_err(),
                    "Accepted invalid {} for {}",
                    parameter.label,
                    op.name()
                );
            }
        }
    }
    eprintln!("Verified {} catalog operations", ids.len());
}

#[test]
fn geometry_maps_coordinates_and_retains_timing() {
    let source = grid();
    for (op, size, value) in [
        (Operation::Rotate90, (2, 4), 10),
        (Operation::Rotate180, (4, 2), 13),
        (Operation::Rotate270, (2, 4), 3),
        (Operation::Transpose, (2, 4), 0),
        (Operation::FlipHorizontal, (4, 2), 3),
        (Operation::FlipVertical, (4, 2), 10),
        (Operation::Roll { x: 1, y: -1 }, (4, 2), 13),
        (
            Operation::Crop {
                x: 1,
                y: 0,
                width: 2,
                height: 2,
            },
            (2, 2),
            1,
        ),
    ] {
        let out = run(&source, op);
        assert_eq!(out.frames[0].pixels.dimensions(), size);
        assert_eq!(out.frames[0].pixels.get_pixel(0, 0)[0], value);
        assert_eq!(out.frames[0].delay_ms, 70);
        assert_eq!(out.repeat, source.repeat);
    }
    assert_eq!(
        run(
            &source,
            Operation::Fit {
                width: 2,
                height: 2
            }
        )
        .frames[0]
            .pixels
            .dimensions(),
        (2, 1)
    );
    let cropped = run(
        &source,
        Operation::Canvas {
            width: 2,
            height: 2,
        },
    );
    assert_eq!(cropped.frames[0].pixels.get_pixel(0, 0)[0], 1);
    let padded = run(
        &source,
        Operation::Canvas {
            width: 6,
            height: 4,
        },
    );
    assert_eq!(padded.frames[0].pixels.get_pixel(0, 0)[3], 0);
    assert_eq!(padded.frames[0].pixels.get_pixel(1, 1)[0], 0);
    let border = run(
        &source,
        Operation::Border {
            pixels: 1,
            red: 0,
            green: 255,
            blue: 0,
        },
    );
    assert_eq!(border.frames[0].pixels.dimensions(), (6, 4));
    assert_eq!(border.frames[0].pixels.get_pixel(0, 0).0, [0, 255, 0, 255]);
    assert_eq!(border.frames[0].pixels.get_pixel(1, 1)[0], 0);
    let rotated = run(&source, Operation::Rotate { degrees: 45. });
    assert_eq!(rotated.frames[0].pixels.dimensions(), (5, 5));
    assert_eq!(rotated.frames[0].pixels.get_pixel(0, 0)[3], 0);
    assert_eq!(
        run(&source, Operation::Rotate { degrees: 90. }).frames[0].pixels,
        run(&source, Operation::Rotate90).frames[0].pixels
    );
}

#[test]
fn fill_does_not_allocate_an_enormous_intermediate_for_extreme_aspect_ratios() {
    let source = animation(vec![(
        RgbaImage::from_pixel(4096, 1, Rgba([255, 0, 0, 255])),
        30,
    )]);
    let out = run(
        &source,
        Operation::Fill {
            width: 1,
            height: 4096,
        },
    );
    assert_eq!(out.frames[0].pixels.dimensions(), (1, 4096));
    assert!(
        out.frames[0]
            .pixels
            .pixels()
            .all(|p| p.0 == [255, 0, 0, 255])
    );
}

#[test]
fn trim_uses_the_union_of_all_frames_and_handles_blank_input() {
    let mut a = RgbaImage::new(5, 4);
    a.put_pixel(1, 1, Rgba([255, 0, 0, 255]));
    let mut b = RgbaImage::new(5, 4);
    b.put_pixel(3, 2, Rgba([0, 255, 0, 255]));
    let source = animation(vec![(a, 30), (b, 90)]);
    let out = run(&source, Operation::TrimTransparent);
    assert!(out.frames.iter().all(|f| f.pixels.dimensions() == (3, 2)));
    assert_eq!(out.frames[0].pixels.get_pixel(0, 0).0, [255, 0, 0, 255]);
    assert_eq!(out.frames[1].pixels.get_pixel(2, 1).0, [0, 255, 0, 255]);
    assert_eq!(delays(&out), vec![30, 90]);
    let blank = run(&solid([0, 0, 0, 0]), Operation::TrimTransparent);
    assert_eq!(blank.frames[0].pixels.dimensions(), (1, 1));
    assert_eq!(blank.frames[0].pixels.get_pixel(0, 0)[3], 0);
}

#[test]
fn timeline_operations_preserve_frame_identity_and_define_timing() {
    let source = sequence();
    assert_eq!(
        delays(&run(&source, Operation::Speed { percent: 200. })),
        vec![15, 35, 55]
    );
    assert_eq!(
        delays(&run(&source, Operation::SetDelay { milliseconds: 40 })),
        vec![40, 40, 40]
    );
    assert_eq!(
        delays(&run(&source, Operation::FrameRate { fps: 15 })),
        vec![70, 60, 70]
    );
    assert_eq!(
        delays(&run(&source, Operation::TrimFrames { first: 2, last: 3 })),
        vec![70, 110]
    );
    assert_eq!(
        delays(&run(&source, Operation::KeepEvery { step: 2 })),
        vec![100, 110]
    );
    assert_eq!(
        delays(&run(&source, Operation::PingPong)),
        vec![30, 70, 110, 70]
    );
    assert_eq!(
        delays(&run(&source, Operation::RepeatFrames { times: 2 })),
        vec![30, 70, 110, 30, 70, 110]
    );
    assert_eq!(
        delays(&run(&source, Operation::ShiftFrames { offset: 2 })),
        vec![70, 110, 30]
    );
    assert_eq!(
        delays(&run(&source, Operation::HoldFirst { milliseconds: 500 })),
        vec![530, 70, 110]
    );
    assert_eq!(
        delays(&run(&source, Operation::HoldLast { milliseconds: 500 })),
        vec![30, 70, 610]
    );
    let pong = run(&source, Operation::PingPong);
    assert!(Arc::ptr_eq(
        &pong.frames[3].pixels,
        &source.frames[1].pixels
    ));
    let fast = run(&source, Operation::Speed { percent: 200. });
    assert!(Arc::ptr_eq(
        &fast.frames[0].pixels,
        &source.frames[0].pixels
    ));
    assert_eq!(source.frames[0].delay_ms, 30);
    let twice = run(&source, Operation::RepeatFrames { times: 2 });
    assert!(Arc::ptr_eq(
        &twice.frames[0].pixels,
        &twice.frames[3].pixels
    ));
}

#[test]
fn duplicates_merge_delays_but_do_not_exceed_the_gif_delay_limit() {
    let a = RgbaImage::from_pixel(1, 1, Rgba([255, 0, 0, 255]));
    let b = RgbaImage::from_pixel(1, 1, Rgba([0, 0, 255, 255]));
    let source = animation(vec![(a.clone(), 30), (a.clone(), 70), (b, 110)]);
    let out = run(&source, Operation::RemoveDuplicates);
    assert_eq!(delays(&out), vec![100, 110]);
    let long = animation(vec![(a.clone(), img::MAX_DELAY_MS), (a, 10)]);
    assert_eq!(
        delays(&run(&long, Operation::RemoveDuplicates)),
        vec![img::MAX_DELAY_MS, 10]
    );
}

#[test]
fn loop_count_exports_once_finitely_and_forever() {
    let source = sequence();
    let dir = tempfile::tempdir().unwrap();
    for (plays, expected) in [
        (0, gif::Repeat::Infinite),
        (1, gif::Repeat::Finite(0)),
        (3, gif::Repeat::Finite(2)),
    ] {
        let out = run(&source, Operation::LoopCount { plays });
        assert_eq!(out.repeat, expected);
        let path = dir.path().join(format!("{plays}.gif"));
        out.save(&path).unwrap();
        assert_eq!(Animation::load(&path).unwrap().repeat, expected);
        if plays == 1 {
            assert!(
                !std::fs::read(path)
                    .unwrap()
                    .windows(11)
                    .any(|w| w == b"NETSCAPE2.0")
            );
        }
    }
}

#[test]
fn exact_color_transforms_preserve_alpha() {
    let red = solid([255, 0, 0, 127]);
    assert_eq!(pixel(&red, Operation::Grayscale), [54, 54, 54, 127]);
    assert_eq!(pixel(&red, Operation::Sepia), [100, 89, 69, 127]);
    assert_eq!(
        pixel(&red, Operation::Hue { degrees: 120. }),
        [0, 255, 0, 127]
    );
    assert_eq!(
        pixel(&red, Operation::Saturation { percent: 0. }),
        [54, 54, 54, 127]
    );
    assert_eq!(
        pixel(
            &red,
            Operation::ColorTint {
                red: 10,
                green: 20,
                blue: 30,
                percent: 100.
            }
        ),
        [10, 20, 30, 127]
    );
    let source = solid([250, 100, 0, 128]);
    assert_eq!(
        pixel(&source, Operation::Brightness { amount: 20 }),
        [255, 120, 20, 128]
    );
    assert_eq!(
        pixel(
            &source,
            Operation::ColorBalance {
                red: -10,
                green: 20,
                blue: -10
            }
        ),
        [240, 120, 0, 128]
    );
    assert_eq!(
        pixel(&source, Operation::Contrast { amount: 0. }),
        [250, 100, 0, 128]
    );
    assert_eq!(
        pixel(&source, Operation::Gamma { gamma: 1. }),
        [250, 100, 0, 128]
    );
    assert_eq!(
        pixel(
            &solid([128, 128, 128, 255]),
            Operation::Exposure { stops: 1. }
        ),
        [176, 176, 176, 255]
    );
    assert_eq!(
        pixel(
            &solid([0, 128, 255, 128]),
            Operation::Solarize { threshold: 127 }
        ),
        [0, 127, 0, 128]
    );
    assert_eq!(
        pixel(
            &solid([100, 100, 255, 128]),
            Operation::Posterize { levels: 3 }
        ),
        [128, 128, 255, 128]
    );
}

#[test]
fn auto_levels_uses_a_shared_range_across_frames_and_ignores_invisible_outliers() {
    let a = RgbaImage::from_fn(2, 1, |x, _| {
        if x == 0 {
            Rgba([10, 100, 20, 255])
        } else {
            Rgba([0, 255, 0, 0])
        }
    });
    let b = RgbaImage::from_pixel(2, 1, Rgba([20, 200, 40, 255]));
    let out = run(&animation(vec![(a, 30), (b, 70)]), Operation::AutoLevels);
    assert_eq!(out.frames[0].pixels.get_pixel(0, 0).0, [0, 0, 0, 255]);
    assert_eq!(out.frames[1].pixels.get_pixel(0, 0).0, [255, 255, 255, 255]);
}

#[test]
fn transparency_and_fades_have_explicit_compositing_semantics() {
    let source = solid([255, 0, 0, 128]);
    assert_eq!(
        pixel(&source, Operation::Opacity { percent: 50. }),
        [255, 0, 0, 64]
    );
    assert_eq!(pixel(&source, Operation::AlphaMask), [128, 128, 128, 255]);
    assert_eq!(
        pixel(
            &source,
            Operation::Matte {
                red: 255,
                green: 255,
                blue: 255
            }
        ),
        [255, 127, 127, 255]
    );
    assert_eq!(
        pixel(&source, Operation::AlphaThreshold { level: 129 })[3],
        0
    );
    assert_eq!(
        pixel(&source, Operation::AlphaThreshold { level: 128 })[3],
        255
    );
    assert_eq!(
        pixel(
            &solid([250, 255, 252, 200]),
            Operation::ColorKey {
                red: 255,
                green: 255,
                blue: 255,
                tolerance: 5
            }
        )[3],
        0
    );
    assert_eq!(
        pixel(
            &solid([245, 244, 244, 200]),
            Operation::ColorKey {
                red: 255,
                green: 255,
                blue: 255,
                tolerance: 10
            }
        )[3],
        200
    );
    let source = animation(
        (0..3)
            .map(|_| (RgbaImage::from_pixel(1, 1, Rgba([120, 60, 30, 128])), 70))
            .collect(),
    );
    let fade = run(
        &source,
        Operation::FadeIn {
            frames: 3,
            red: 0,
            green: 0,
            blue: 0,
        },
    );
    assert_eq!(fade.frames[0].pixels.get_pixel(0, 0).0, [0, 0, 0, 128]);
    assert_eq!(fade.frames[1].pixels.get_pixel(0, 0).0, [60, 30, 15, 128]);
    assert_eq!(fade.frames[2].pixels.get_pixel(0, 0).0, [120, 60, 30, 128]);
    let fade = run(
        &source,
        Operation::FadeOut {
            frames: 3,
            red: 0,
            green: 0,
            blue: 0,
        },
    );
    assert_eq!(fade.frames[0].pixels.get_pixel(0, 0).0, [120, 60, 30, 128]);
    assert_eq!(fade.frames[2].pixels.get_pixel(0, 0).0, [0, 0, 0, 128]);
}

#[test]
fn resizing_and_blurring_transparency_do_not_introduce_black_halos() {
    let image = RgbaImage::from_fn(4, 1, |x, _| {
        if x < 2 {
            Rgba([255, 0, 0, 255])
        } else {
            Rgba([0, 0, 0, 0])
        }
    });
    let source = animation(vec![(image, 70)]);
    for op in [
        Operation::Resize {
            width: 2,
            height: 1,
        },
        Operation::Blur { sigma: 1. },
    ] {
        let out = run(&source, op);
        for p in out.frames[0].pixels.pixels() {
            if p[3] > 0 {
                assert_eq!(p[0], 255);
                assert_eq!(p[1], 0);
                assert_eq!(p[2], 0);
            }
        }
    }
}

#[test]
fn effects_are_deterministic_and_keep_alpha_except_spatial_resampling() {
    let source = animation(vec![(
        RgbaImage::from_fn(8, 8, |x, y| {
            Rgba([
                (x * 30) as u8,
                (y * 30) as u8,
                128,
                if (x + y) % 4 == 0 { 0 } else { 180 },
            ])
        }),
        70,
    )]);
    let a = run(
        &source,
        Operation::Noise {
            amount: 20,
            seed: 42,
        },
    );
    let b = run(
        &source,
        Operation::Noise {
            amount: 20,
            seed: 42,
        },
    );
    let c = run(
        &source,
        Operation::Noise {
            amount: 20,
            seed: 43,
        },
    );
    assert_eq!(a.frames[0].pixels, b.frames[0].pixels);
    assert_ne!(a.frames[0].pixels, c.frames[0].pixels);
    for op in [
        Operation::Noise {
            amount: 20,
            seed: 42,
        },
        Operation::Sharpen {
            sigma: 1.,
            threshold: 2,
        },
        Operation::Pixelate { block: 2 },
        Operation::Edges,
        Operation::Emboss { strength: 1. },
        Operation::OrderedDither { levels: 3 },
        Operation::Dither { levels: 3 },
        Operation::Vignette { percent: 100. },
        Operation::Scanlines {
            spacing: 2,
            percent: 100.,
        },
    ] {
        let out = run(&source, op.clone());
        if !matches!(op, Operation::Pixelate { .. }) {
            assert!(
                out.frames[0]
                    .pixels
                    .pixels()
                    .zip(source.frames[0].pixels.pixels())
                    .all(|(a, b)| a[3] == b[3]),
                "{} alpha",
                op.name()
            );
        }
    }
    let flat = solid([100, 100, 100, 255]);
    assert_eq!(pixel(&flat, Operation::Edges), [0, 0, 0, 255]);
    assert_eq!(
        pixel(&flat, Operation::Emboss { strength: 1. }),
        [128, 128, 128, 255]
    );
    let white = solid([255, 255, 255, 255]);
    let vignette = run(&white, Operation::Vignette { percent: 100. });
    assert_eq!(vignette.frames[0].pixels.get_pixel(1, 1)[0], 255);
    assert_eq!(vignette.frames[0].pixels.get_pixel(0, 0)[0], 0);
    let lines = run(
        &white,
        Operation::Scanlines {
            spacing: 2,
            percent: 100.,
        },
    );
    assert_eq!(lines.frames[0].pixels.get_pixel(0, 0)[0], 0);
    assert_eq!(lines.frames[0].pixels.get_pixel(0, 1)[0], 255);
    let dither = run(&flat, Operation::Dither { levels: 2 });
    assert!(
        dither.frames[0]
            .pixels
            .pixels()
            .all(|p| p.0[..3].iter().all(|v| *v == 0 || *v == 255))
    );
}

#[test]
fn inverse_and_identity_operations_do_not_mutate_the_source() {
    let source = grid();
    let before = source.frames[0].pixels.clone();
    for pair in [
        [Operation::FlipHorizontal, Operation::FlipHorizontal],
        [Operation::FlipVertical, Operation::FlipVertical],
        [Operation::Rotate90, Operation::Rotate270],
        [Operation::Transpose, Operation::Transpose],
        [Operation::Negate, Operation::Negate],
        [Operation::Reverse, Operation::Reverse],
    ] {
        let cards = pair
            .into_iter()
            .enumerate()
            .map(|(i, operation)| Card {
                id: i as u64,
                enabled: true,
                operation,
            })
            .collect::<Vec<_>>();
        let out = img::process(source.clone(), &cards).unwrap();
        assert_eq!(out.last().unwrap().frames[0].pixels, before);
    }
    for op in [
        Operation::Rotate { degrees: 0. },
        Operation::Swirl { degrees: 0. },
        Operation::Wave {
            amplitude: 0.,
            wavelength: 10.,
        },
    ] {
        assert_eq!(run(&source, op).frames[0].pixels, before);
    }
    assert_eq!(source.frames[0].pixels, before);
}

#[test]
fn invalid_parameters_ranges_and_frame_growth_fail_before_allocation() {
    let source = sequence();
    for op in [
        Operation::Crop {
            x: 3,
            y: 0,
            width: 2,
            height: 1,
        },
        Operation::TrimFrames { first: 3, last: 2 },
        Operation::RepeatFrames { times: 1000 },
        Operation::ShiftFrames { offset: 4 },
        Operation::FadeIn {
            frames: 4,
            red: 0,
            green: 0,
            blue: 0,
        },
        Operation::Gamma { gamma: f32::NAN },
        Operation::Wave {
            amplitude: 1.,
            wavelength: 0.,
        },
        Operation::Blur {
            sigma: f32::INFINITY,
        },
    ] {
        assert!(
            img::process(
                source.clone(),
                &[Card {
                    id: 1,
                    enabled: true,
                    operation: op.clone()
                }]
            )
            .is_err(),
            "{} should fail",
            op.name()
        );
    }
    let long = animation(vec![(RgbaImage::new(1, 1), img::MAX_DELAY_MS)]);
    assert!(
        img::process(
            long,
            &[Card {
                id: 1,
                enabled: true,
                operation: Operation::HoldLast { milliseconds: 1 }
            }]
        )
        .is_err()
    );
    let too_many = vec![
        Card {
            id: 1,
            enabled: true,
            operation: Operation::Reverse
        };
        img::MAX_OPERATIONS + 1
    ];
    assert!(img::process(source.clone(), &too_many).is_err());
    let valid = vec![
        Card {
            id: 1,
            enabled: true,
            operation: Operation::Reverse
        };
        img::MAX_OPERATIONS
    ];
    assert_eq!(
        img::process(source, &valid).unwrap().len(),
        img::MAX_OPERATIONS
    );
}

#[test]
fn repeated_pixels_are_transformed_once_for_frame_invariant_operations() {
    let source = solid([10, 20, 30, 255]);
    let repeated = run(&source, Operation::RepeatFrames { times: 10 });
    let negated = run(&repeated, Operation::Negate);
    assert!(
        negated
            .frames
            .iter()
            .all(|f| Arc::ptr_eq(&f.pixels, &negated.frames[0].pixels))
    );
    let resized = run(
        &repeated,
        Operation::Resize {
            width: 10,
            height: 10,
        },
    );
    assert!(
        resized
            .frames
            .iter()
            .all(|f| Arc::ptr_eq(&f.pixels, &resized.frames[0].pixels))
    );
    let noise = run(
        &repeated,
        Operation::Noise {
            amount: 10,
            seed: 1,
        },
    );
    assert!(!Arc::ptr_eq(
        &noise.frames[0].pixels,
        &noise.frames[1].pixels
    ));
}
