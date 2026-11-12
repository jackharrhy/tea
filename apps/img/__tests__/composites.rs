use image::{Rgba, RgbaImage};
use img::{Animation, Card, Frame, Operation};
use std::sync::Arc;
fn source(frames: Vec<(RgbaImage, u32)>) -> Arc<Animation> {
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
fn run(source: &Arc<Animation>, op: Operation) -> Arc<Animation> {
    img::process(
        source.clone(),
        &[Card {
            id: 1,
            enabled: true,
            operation: op,
        }],
    )
    .unwrap()
    .remove(0)
}
fn overlay(path: String) -> Operation {
    Operation::Overlay {
        path,
        x: 0,
        y: 0,
        width: 0,
        percent: 100.,
    }
}
fn caption(text: &str) -> Operation {
    Operation::Text {
        text: text.into(),
        x: 2,
        y: 2,
        size: 16,
        red: 255,
        green: 255,
        blue: 255,
        outline: 1,
        font: String::new(),
        tracking: 0.,
        leading: 100.,
        align: 0,
    }
}

#[test]
fn text_draws_outlined_glyphs_with_transparency_and_preserves_frame_metadata() {
    let input = source(vec![
        (RgbaImage::new(80, 32), 70),
        (RgbaImage::new(80, 32), 130),
    ]);
    let out = run(&input, caption("Hello"));
    assert_eq!(out.repeat, input.repeat);
    assert_eq!(out.frames.len(), 2);
    assert!(
        out.frames[0]
            .pixels
            .pixels()
            .any(|p| p[3] > 0 && p[0] > 200)
    );
    assert!(out.frames[0].pixels.pixels().any(|p| p[3] > 0 && p[0] == 0));
    assert_eq!(out.frames[0].pixels, out.frames[1].pixels);
    assert_eq!(out.frames[1].delay_ms, 130);
    assert!(input.frames[0].pixels.pixels().all(|p| p[3] == 0));
    let empty = run(&input, caption(""));
    assert!(Arc::ptr_eq(
        &empty.frames[0].pixels,
        &input.frames[0].pixels
    ));
    let mut clipped = caption("Outside");
    if let Operation::Text { x, y, .. } = &mut clipped {
        *x = -4000;
        *y = -4000;
    }
    assert_eq!(
        run(&input, clipped).frames[0].pixels,
        input.frames[0].pixels
    );
    let multiline = run(&input, caption("A\nB"));
    assert!(
        multiline.frames[0]
            .pixels
            .enumerate_pixels()
            .any(|(_, y, p)| y > 20 && p[3] > 0)
    );
}

#[test]
fn png_overlay_supports_clipping_opacity_and_aspect_preserving_scale() {
    let dir = tempfile::tempdir().unwrap();
    let asset = dir.path().join("overlay with spaces.png ");
    RgbaImage::from_pixel(2, 2, Rgba([255, 0, 0, 255]))
        .save_with_format(&asset, image::ImageFormat::Png)
        .unwrap();
    let input = source(vec![(
        RgbaImage::from_pixel(3, 2, Rgba([0, 0, 255, 255])),
        100,
    )]);
    let mut op = overlay(asset.to_str().unwrap().into());
    if let Operation::Overlay { x, percent, .. } = &mut op {
        *x = 1;
        *percent = 50.;
    }
    let values: Vec<_> = op.parameters().into_iter().map(|p| p.value).collect();
    op = op.with_parameters(&values).unwrap();
    let out = run(&input, op);
    assert_eq!(out.frames[0].pixels.get_pixel(0, 0).0, [0, 0, 255, 255]);
    let pixel = out.frames[0].pixels.get_pixel(1, 0);
    assert!(pixel[0].abs_diff(128) <= 1 && pixel[2].abs_diff(127) <= 1);
    assert_eq!(pixel[3], 255);
    let mut op = overlay(asset.to_str().unwrap().into());
    if let Operation::Overlay { x, .. } = &mut op {
        *x = -1;
    }
    let out = run(&input, op);
    assert_eq!(out.frames[0].pixels.get_pixel(0, 0).0, [255, 0, 0, 255]);
    assert_eq!(out.frames[0].pixels.get_pixel(1, 0).0, [0, 0, 255, 255]);
    let mut op = overlay(asset.to_str().unwrap().into());
    if let Operation::Overlay { width, .. } = &mut op {
        *width = 1;
    }
    let out = run(&input, op);
    assert_eq!(out.frames[0].pixels.get_pixel(0, 0).0, [255, 0, 0, 255]);
    assert_eq!(out.frames[0].pixels.get_pixel(0, 1).0, [0, 0, 255, 255]);
}

#[test]
fn animated_overlay_keeps_animating_over_a_single_held_source_frame() {
    let dir = tempfile::tempdir().unwrap();
    let asset = dir.path().join("overlay.gif");
    source(vec![
        (RgbaImage::from_pixel(1, 1, Rgba([255, 0, 0, 255])), 50),
        (RgbaImage::from_pixel(1, 1, Rgba([0, 255, 0, 255])), 50),
    ])
    .save(&asset)
    .unwrap();
    let input = source(vec![(
        RgbaImage::from_pixel(1, 1, Rgba([0, 0, 255, 255])),
        200,
    )]);
    let out = run(&input, overlay(asset.to_str().unwrap().into()));
    assert_eq!(
        out.frames.iter().map(|f| f.delay_ms).collect::<Vec<_>>(),
        vec![50, 50, 50, 50]
    );
    assert_eq!(
        out.frames
            .iter()
            .map(|f| f.pixels.get_pixel(0, 0).0)
            .collect::<Vec<_>>(),
        vec![
            [255, 0, 0, 255],
            [0, 255, 0, 255],
            [255, 0, 0, 255],
            [0, 255, 0, 255]
        ]
    );
    assert!(Arc::ptr_eq(&out.frames[0].pixels, &out.frames[2].pixels));
    assert_eq!(out.repeat, input.repeat);
}

#[test]
fn overlay_merges_both_sets_of_frame_boundaries_and_can_then_deduplicate() {
    let dir = tempfile::tempdir().unwrap();
    let asset = dir.path().join("overlay.gif");
    source(vec![
        (RgbaImage::from_pixel(1, 1, Rgba([255, 0, 0, 255])), 30),
        (RgbaImage::from_pixel(1, 1, Rgba([0, 255, 0, 255])), 70),
    ])
    .save(&asset)
    .unwrap();
    let input = source(vec![
        (RgbaImage::from_pixel(1, 1, Rgba([0, 0, 255, 255])), 50),
        (RgbaImage::from_pixel(1, 1, Rgba([255, 255, 0, 255])), 50),
    ]);
    let out = run(&input, overlay(asset.to_str().unwrap().into()));
    assert_eq!(
        out.frames.iter().map(|f| f.delay_ms).collect::<Vec<_>>(),
        vec![30, 20, 50]
    );
    let merged = run(&out, Operation::RemoveDuplicates);
    assert_eq!(
        merged.frames.iter().map(|f| f.delay_ms).collect::<Vec<_>>(),
        vec![30, 70]
    );
}

#[test]
fn overlay_limits_growth_before_rendering_and_reports_missing_assets() {
    let dir = tempfile::tempdir().unwrap();
    let asset = dir.path().join("overlay.gif");
    source(vec![
        (RgbaImage::from_pixel(1, 1, Rgba([255, 0, 0, 255])), 10),
        (RgbaImage::from_pixel(1, 1, Rgba([0, 255, 0, 255])), 10),
    ])
    .save(&asset)
    .unwrap();
    let input = source(vec![(RgbaImage::new(1, 1), 20000)]);
    let result = img::process(
        input.clone(),
        &[Card {
            id: 1,
            enabled: true,
            operation: overlay(asset.to_str().unwrap().into()),
        }],
    );
    assert!(format!("{:#}", result.unwrap_err()).contains("1000 frames"));
    assert!(
        img::process(
            input.clone(),
            &[Card {
                id: 1,
                enabled: true,
                operation: overlay(dir.path().join("missing.png").to_str().unwrap().into())
            }]
        )
        .is_err()
    );
    let blank = run(&input, overlay(String::new()));
    assert!(Arc::ptr_eq(
        &blank.frames[0].pixels,
        &input.frames[0].pixels
    ));
}

#[test]
fn shared_palette_limits_colors_without_changing_alpha_or_solid_colors() {
    let input = source(vec![(
        RgbaImage::from_fn(20, 10, |x, y| {
            Rgba([
                (x * 12) as u8,
                (y * 25) as u8,
                80,
                if x == 0 { 0 } else { 128 },
            ])
        }),
        70,
    )]);
    for colors in [2, 16, 64, 256] {
        let out = run(&input, Operation::Quantize { colors });
        let unique: std::collections::HashSet<_> = out.frames[0]
            .pixels
            .pixels()
            .filter(|p| p[3] > 0)
            .map(|p| [p[0], p[1], p[2]])
            .collect();
        assert!(unique.len() < colors as usize);
        assert!(
            out.frames[0]
                .pixels
                .pixels()
                .zip(input.frames[0].pixels.pixels())
                .all(|(a, b)| a[3] == b[3])
        );
    }
    let red = source(vec![(
        RgbaImage::from_pixel(1, 1, Rgba([255, 0, 0, 128])),
        70,
    )]);
    assert_eq!(
        run(&red, Operation::Quantize { colors: 64 }).frames[0]
            .pixels
            .get_pixel(0, 0)
            .0,
        [255, 0, 0, 128]
    );
}

#[test]
fn rounded_corners_preserve_the_center_and_source_color() {
    let input = source(vec![(
        RgbaImage::from_pixel(8, 8, Rgba([255, 128, 64, 255])),
        70,
    )]);
    let out = run(&input, Operation::RoundCorners { radius: 4 });
    assert_eq!(out.frames[0].pixels.get_pixel(0, 0)[3], 0);
    assert_eq!(out.frames[0].pixels.get_pixel(4, 4).0, [255, 128, 64, 255]);
    assert!(
        out.frames[0]
            .pixels
            .pixels()
            .all(|p| p.0[..3] == [255, 128, 64])
    );
}

#[test]
fn gif_export_reserves_one_transparent_entry_for_different_hidden_colors() {
    let image = RgbaImage::from_raw(
        4,
        1,
        vec![255, 0, 0, 0, 0, 255, 0, 0, 0, 0, 0, 255, 20, 30, 40, 128],
    )
    .unwrap();
    let input = source(vec![(image, 70)]);
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("alpha.gif");
    input.save(&path).unwrap();
    let decoded = Animation::load(&path).unwrap();
    assert_eq!(decoded.frames[0].pixels.get_pixel(0, 0)[3], 0);
    assert_eq!(decoded.frames[0].pixels.get_pixel(1, 0)[3], 0);
    assert_eq!(decoded.frames[0].pixels.get_pixel(2, 0).0, [0, 0, 0, 255]);
    assert_eq!(
        decoded.frames[0].pixels.get_pixel(3, 0).0,
        [20, 30, 40, 255]
    );
}

#[test]
fn lossy_gif_palette_never_makes_opaque_black_transparent_or_loses_alpha_holes() {
    let mut image = RgbaImage::from_fn(32, 16, |x, y| {
        Rgba([
            (x * 8) as u8,
            (y * 16) as u8,
            ((x * 37 + y * 11) % 256) as u8,
            if (x + y) % 7 == 0 { 0 } else { 255 },
        ])
    });
    image.put_pixel(2, 0, Rgba([0, 0, 0, 255]));
    let input = source(vec![(image, 70)]);
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("lossy.gif");
    input.save(&path).unwrap();
    let decoded = Animation::load(&path).unwrap();
    for (a, b) in decoded.frames[0]
        .pixels
        .pixels()
        .zip(input.frames[0].pixels.pixels())
    {
        assert_eq!(a[3], b[3]);
    }
    assert_eq!(decoded.frames[0].pixels.get_pixel(2, 0)[3], 255);
}

#[test]
fn text_measurement_contains_the_same_glyphs_and_outline_as_export_rendering() {
    for text in ["img", "A\nB", "jazz", "  ", ""] {
        for outline in [0, 1, 4] {
            let mut operation = caption(text);
            if let Operation::Text {
                x,
                y,
                size,
                outline: value,
                ..
            } = &mut operation
            {
                *x = 13;
                *y = 7;
                *size = 24;
                *value = outline;
            }
            let input = source(vec![(RgbaImage::new(160, 90), 70)]);
            let rendered = run(&input, operation.clone());
            let visible: Vec<_> = rendered.frames[0]
                .pixels
                .enumerate_pixels()
                .filter(|(_, _, p)| p[3] > 0)
                .collect();
            if let Some([x, y, w, h]) = operation.text_bounds() {
                assert!(w > 0 && h > 0);
                assert!(visible.iter().all(|(px, py, _)| *px as i32 >= x
                    && (*px as i32) < x + w
                    && *py as i32 >= y
                    && (*py as i32) < y + h));
            } else {
                assert!(visible.is_empty());
            }
        }
    }
}

#[test]
fn typography_changes_spacing_and_aligns_lines_without_changing_frame_metadata() {
    let input = source(vec![(RgbaImage::new(240, 180), 70)]);
    let mut operation = caption("MMMM\nI");
    if let Operation::Text {
        x,
        y,
        size,
        outline,
        ..
    } = &mut operation
    {
        *x = 10;
        *y = 8;
        *size = 28;
        *outline = 0;
    }
    let original = run(&input, operation.clone());
    let original_bounds = operation.text_bounds().unwrap();
    if let Operation::Text {
        tracking,
        leading,
        align,
        ..
    } = &mut operation
    {
        *tracking = 4.;
        *leading = 160.;
        *align = 2;
    }
    let rendered = run(&input, operation.clone());
    let bounds = operation.text_bounds().unwrap();
    assert!(bounds[2] > original_bounds[2]);
    assert!(bounds[3] > original_bounds[3]);
    let second_line_left = |image: &RgbaImage, top: u32| {
        image
            .enumerate_pixels()
            .filter(|(_, y, p)| *y > top && p[3] > 0)
            .map(|(x, _, _)| x)
            .min()
            .unwrap()
    };
    assert!(
        second_line_left(&rendered.frames[0].pixels, 40)
            > second_line_left(&original.frames[0].pixels, 32) + 20
    );
    assert_eq!(rendered.frames[0].delay_ms, 70);
    assert_eq!(rendered.repeat, input.repeat);
    for (x, y, _) in rendered.frames[0]
        .pixels
        .enumerate_pixels()
        .filter(|(_, _, p)| p[3] > 0)
    {
        assert!(x as i32 >= bounds[0] && (x as i32) < bounds[0] + bounds[2]);
        assert!(y as i32 >= bounds[1] && (y as i32) < bounds[1] + bounds[3]);
    }
}

#[test]
fn installed_font_renders_matching_bounds_and_survives_gif_export() {
    img::fonts::load_system_fonts();
    let Some(choice) = img::fonts::choices().unwrap().iter().find(|font| {
        !img::fonts::builtins()
            .iter()
            .any(|builtin| builtin.id == font.id)
    }) else {
        return;
    };
    let input = source(vec![(RgbaImage::new(240, 120), 70)]);
    let mut operation = caption("System font");
    if let Operation::Text { font, size, .. } = &mut operation {
        *font = choice.id.clone();
        *size = 24;
    }
    let bounds = operation.text_bounds().unwrap();
    let rendered = run(&input, operation.clone());
    assert!(rendered.frames[0].pixels.pixels().any(|p| p[3] > 0));
    for (x, y, _) in rendered.frames[0]
        .pixels
        .enumerate_pixels()
        .filter(|(_, _, p)| p[3] > 0)
    {
        assert!(x as i32 >= bounds[0] && (x as i32) < bounds[0] + bounds[2]);
        assert!(y as i32 >= bounds[1] && (y as i32) < bounds[1] + bounds[3]);
    }
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("font.gif");
    rendered.save(&path).unwrap();
    let decoded = Animation::load(&path).unwrap();
    assert_eq!(decoded.frames[0].delay_ms, 70);
    for (a, b) in decoded.frames[0]
        .pixels
        .pixels()
        .zip(rendered.frames[0].pixels.pixels())
    {
        assert_eq!(a[3] > 0, b[3] > 0);
    }
    if let Operation::Text { font, .. } = &mut operation {
        *font = "img-test-missing-font".into();
    }
    let error = img::process(
        input,
        &[Card {
            id: 1,
            enabled: true,
            operation,
        }],
    )
    .unwrap_err();
    let error = format!("{error:#}");
    assert!(error.contains("no longer installed"), "{error}");
}

#[test]
fn embedded_caption_fonts_render_distinct_faces_without_system_font_discovery() {
    let input = source(vec![(RgbaImage::new(260, 100), 70)]);
    let mut masks = std::collections::HashSet::new();
    for choice in img::fonts::builtins() {
        let mut operation = caption("CLASSIC GIF");
        if let Operation::Text { font, size, .. } = &mut operation {
            *font = choice.id.clone();
            *size = 32;
        }
        let bounds = operation.text_bounds().unwrap();
        assert!(bounds[2] > 0 && bounds[3] > 0);
        let rendered = run(&input, operation);
        let mask: Vec<_> = rendered.frames[0].pixels.pixels().map(|p| p[3]).collect();
        assert!(mask.contains(&255));
        assert!(
            masks.insert(mask),
            "{} must render its own face",
            choice.family
        );
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("caption.gif");
        rendered.save(&path).unwrap();
        let decoded = Animation::load(&path).unwrap();
        for (a, b) in decoded.frames[0]
            .pixels
            .pixels()
            .zip(rendered.frames[0].pixels.pixels())
        {
            assert_eq!(a[3] > 0, b[3] > 0);
        }
    }
    assert_eq!(masks.len(), 4);
}
