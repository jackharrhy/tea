use super::*;

#[test]
fn caption_fields_apply_text_colors_and_keep_arrow_keys_in_the_editor() {
    let mut rt = runtime((980., 820.), false);
    add(&mut rt, "Text caption");
    let before = rt.state.displayed.clone().unwrap();
    enter(&mut rt, "text-1", "Bird");
    click(&mut rt, "color-1");
    enter(&mut rt, "color-hex", "#F0FFFF");
    assert!(
        matches!(&rt.state.cards[0].operation, Operation::Text { text, red: 240, .. } if text == "Bird")
    );
    assert_ne!(
        rt.state.displayed.as_ref().unwrap().frames[0].pixels,
        before.frames[0].pixels
    );
    click(&mut rt, "text-1");
    let frame = rt.state.frame;
    rt.key(KeyEvent {
        key: Key::Right,
        mods: Default::default(),
    });
    rt.frame(0.01);
    assert_eq!(rt.state.frame, frame);
    assert!(rt.find("apply-1").is_none());
}

#[test]
fn overlay_file_dialog_routes_into_the_selected_card_and_renders_the_asset() {
    let mut rt = runtime((980., 820.), false);
    add(&mut rt, "Image / GIF overlay");
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("red square.png");
    image::RgbaImage::from_pixel(3, 3, image::Rgba([255, 0, 0, 255]))
        .save(&path)
        .unwrap();
    click(&mut rt, "file-1");
    assert!(rt.file_dialog().is_some());
    rt.resolve_file_dialog(Some(path.clone())).unwrap();
    rt.frame(0.01);
    settle(&mut rt);
    assert_eq!(rt.state.fields[&1][0].text, path.to_str().unwrap());
    assert_eq!(
        rt.state.outputs.get(0).unwrap().frames[0]
            .pixels
            .get_pixel(0, 0)
            .0,
        [255, 0, 0, 255]
    );
    enter(&mut rt, "percent-1", "0");
    assert_eq!(
        rt.state.outputs.get(0).unwrap().frames[0].pixels,
        rt.state.source.as_ref().unwrap().frames[0].pixels
    );
}

#[test]
fn text_drag_is_live_without_render_jobs_and_commits_exact_pixels_or_cancels() {
    let mut rt = runtime((980., 820.), false);
    add(&mut rt, "Text caption");
    let original = rt.state.cards[0].operation.clone();
    let selection = rect(&rt, "text-selection");
    let start = (
        selection[0] + selection[2] / 2.,
        selection[1] + selection[3] / 2.,
    );
    rt.pointer_down(start.0, start.1);
    rt.frame(0.01);
    rt.pointer_move(start.0 + 41., start.1 + 33.);
    rt.frame(0.016);
    assert!(
        !rt.state.worker.busy(),
        "Pointer movement must not render the GIF stack"
    );
    assert_eq!(rt.state.cards[0].operation, original);
    let moved = rt.state.placement.as_ref().unwrap().current.clone();
    assert_ne!(moved, original);
    rt.pointer_up(start.0 + 41., start.1 + 33.);
    rt.frame(0.01);
    settle(&mut rt);
    assert!(rt.state.placement.is_none());
    assert_eq!(rt.state.cards[0].operation, moved);
    let reference = img::process(rt.state.source.clone().unwrap(), &rt.state.cards).unwrap();
    assert_eq!(
        rt.state.final_output().unwrap().frames[0].pixels,
        reference[0].frames[0].pixels
    );
    let start = rt.find("text-selection").unwrap();
    rt.pointer_down(start.0, start.1);
    rt.frame(0.01);
    rt.pointer_move(start.0 + 60., start.1 + 25.);
    rt.frame(0.016);
    rt.key(KeyEvent {
        key: Key::Escape,
        mods: Default::default(),
    });
    rt.frame(0.01);
    rt.pointer_up(start.0 + 60., start.1 + 25.);
    rt.frame(0.01);
    assert!(rt.state.placement.is_none());
    assert_eq!(rt.state.cards[0].operation, moved);
    assert!(!rt.state.worker.busy());
}

#[test]
fn text_alignment_resize_and_nudging_use_visible_glyph_bounds() {
    let mut rt = runtime((980., 820.), false);
    add(&mut rt, "Text caption");
    click(&mut rt, "position-1");
    click(&mut rt, "align-1-1-1");
    let centered = rt.state.cards[0].operation.text_bounds().unwrap();
    assert!((centered[0] * 2 + centered[2] - 240).abs() <= 1);
    assert!((centered[1] * 2 + centered[3] - 180).abs() <= 1);
    click(&mut rt, "align-1-2-2");
    let corner = rt.state.cards[0].operation.text_bounds().unwrap();
    assert_eq!(corner[0] + corner[2], 232);
    assert_eq!(corner[1] + corner[3], 172);
    click(&mut rt, "align-1-0-0");
    let before = rt.state.cards[0].operation.clone();
    let original_bounds = before.text_bounds().unwrap();
    let start = rt.find("text-resize").unwrap();
    rt.pointer_down(start.0, start.1);
    rt.frame(0.01);
    rt.pointer_move(start.0 + 60., start.1);
    rt.frame(0.016);
    assert!(!rt.state.worker.busy());
    rt.pointer_up(start.0 + 60., start.1);
    rt.frame(0.01);
    settle(&mut rt);
    let resized = &rt.state.cards[0].operation;
    assert!(
        matches!((before, resized), (Operation::Text { size: old, .. }, Operation::Text { size, .. }) if *size > old)
    );
    let bounds = resized.text_bounds().unwrap();
    assert_eq!(&bounds[..2], &original_bounds[..2]);
    click(&mut rt, "text-selection");
    rt.key(KeyEvent {
        key: Key::Right,
        mods: Default::default(),
    });
    rt.frame(0.01);
    settle(&mut rt);
    assert_eq!(
        rt.state.cards[0].operation.text_bounds().unwrap()[0],
        bounds[0] + 1
    );
}

#[test]
fn selecting_text_in_the_middle_restores_its_base_for_direct_manipulation() {
    let mut rt = runtime((980., 820.), false);
    add(&mut rt, "Resize");
    add(&mut rt, "Text caption");
    add(&mut rt, "Negate");
    assert!(rt.find("text-selection").is_none());
    click(&mut rt, "preview-2");
    assert!(rt.state.outputs.get(0).is_some());
    assert!(rt.find("text-selection").is_some());
    let exported = rt.state.final_output().unwrap();
    assert_eq!(
        exported.frames[0].pixels,
        img::process(rt.state.source.clone().unwrap(), &rt.state.cards).unwrap()[2].frames[0]
            .pixels
    );
}

#[test]
fn text_drag_snaps_to_canvas_center_and_large_captions_stay_bounded_by_the_canvas() {
    let mut rt = runtime((980., 820.), false);
    add(&mut rt, "Text caption");
    let bounds = rt.state.cards[0].operation.text_bounds().unwrap();
    let selection = rect(&rt, "text-selection");
    let scale = selection[2] / bounds[2] as f32;
    let start = (selection[0] + 10., selection[1] + 8.);
    let dx = ((240 - bounds[2]) / 2 - bounds[0]) as f32 * scale + 2.;
    let dy = ((180 - bounds[3]) / 2 - bounds[1]) as f32 * scale - 2.;
    rt.pointer_down(start.0, start.1);
    rt.frame(0.01);
    rt.pointer_move(start.0 + dx, start.1 + dy);
    rt.frame(0.016);
    assert!(rt.find("snap-guide-x").is_some());
    assert!(rt.find("snap-guide-y").is_some());
    let snapped = rt
        .state
        .placement
        .as_ref()
        .unwrap()
        .current
        .text_bounds()
        .unwrap();
    assert!((snapped[0] * 2 + snapped[2] - 240).abs() <= 1);
    assert!((snapped[1] * 2 + snapped[3] - 180).abs() <= 1);
    rt.pointer_up(start.0 + dx, start.1 + dy);
    rt.frame(0.01);
    settle(&mut rt);
    enter(&mut rt, "text-1", &"W".repeat(1000));
    assert!(rt.state.cards[0].operation.text_bounds().unwrap()[2] > 4096);
    let selection = rect(&rt, "text-selection");
    let start = (selection[0] + 10., selection[1] + 8.);
    rt.pointer_down(start.0, start.1);
    rt.frame(0.01);
    assert!(rt.state.placement.is_some());
    rt.pointer_move(start.0 + 24., start.1 + 20.);
    rt.frame(0.016);
    assert!(!rt.state.worker.busy());
    rt.pointer_up(start.0 + 24., start.1 + 20.);
    rt.frame(0.01);
    settle(&mut rt);
    assert!(rt.state.ready());
}

#[test]
fn text_drag_cancels_on_window_blur_and_layout_tracks_the_preview_size() {
    let mut rt = runtime((980., 820.), false);
    add(&mut rt, "Text caption");
    let original = rt.state.cards[0].operation.clone();
    let start = rt.find("text-selection").unwrap();
    rt.pointer_down(start.0, start.1);
    rt.frame(0.01);
    rt.pointer_move(start.0 + 30., start.1 + 30.);
    rt.frame(0.016);
    assert!(rt.state.placement.is_some());
    rt.window_focus(false);
    rt.frame(0.01);
    assert!(rt.state.placement.is_none());
    assert_eq!(rt.state.cards[0].operation, original);
    rt.window_focus(true);
    rt.frame(0.01);
    click(&mut rt, "frames");
    let [x, y, w, h] = rect(&rt, "image");
    let bounds = original.text_bounds().unwrap();
    let scale = (w / 240.).min(h / 180.);
    let selected = rect(&rt, "text-selection");
    assert!((selected[0] - (x + (w - 240. * scale) / 2. + bounds[0] as f32 * scale)).abs() < 1.);
    assert!((selected[1] - (y + (h - 180. * scale) / 2. + bounds[1] as f32 * scale)).abs() < 1.);
    assert!((selected[2] - bounds[2] as f32 * scale).abs() < 1.);
}

#[test]
fn positioning_text_and_editing_properties_preserve_the_inspected_frame() {
    let mut rt = runtime((980., 820.), false);
    add(&mut rt, "Text caption");
    rt.state.seek(5);
    rt.invalidate();
    rt.frame(0.01);
    let start = rt.find("text-selection").unwrap();
    rt.pointer_down(start.0, start.1);
    rt.frame(0.01);
    rt.pointer_move(start.0 + 33., start.1 + 24.);
    rt.frame(0.016);
    rt.pointer_up(start.0 + 33., start.1 + 24.);
    rt.frame(0.01);
    settle(&mut rt);
    assert_eq!(rt.state.frame, 5);
    assert!(!rt.state.playing);
    enter(&mut rt, "size-1", "30");
    assert_eq!(rt.state.frame, 5);
    assert!(!rt.state.playing);
}

#[test]
fn fields_center_the_caret_and_accept_padding_clicks_at_normal_and_retina_scale() {
    for scale in [1., 2.] {
        let size = (980., 820.);
        let mut rt = App::new(AppSpec {
            fonts: font_preview::FONTS,
            poll: Some(poll),
            on_key: Some(on_key),
            ..AppSpec::new("img", size, fixture, view::view)
        })
        .headless_runtime(size, Env::new(false, scale));
        rt.frame(0.);
        add(&mut rt, "Resize");
        let [x, y, w, h] = rect(&rt, "width-1");
        for _ in 0..2 {
            rt.pointer_down(x + 2., y + 2.);
            rt.pointer_up(x + 2., y + 2.);
            rt.frame(0.01);
        }
        let field = rt
            .elements()
            .into_iter()
            .find(|e| e.key.as_deref() == Some("width-1"))
            .unwrap();
        assert!(field.focused);
        let caret = field.caret.expect("Focused numeric field has a caret");
        assert!(
            (caret[1] + caret[3] / 2. - (y + h / 2.)).abs() <= 0.6,
            "Misaligned caret at scale {scale}: field={:?}, caret={caret:?}",
            [x, y, w, h]
        );
        add(&mut rt, "Color tint");
        click(&mut rt, "color-2");
        click(&mut rt, "color-hex");
        let field = rt
            .elements()
            .into_iter()
            .find(|e| e.key.as_deref() == Some("color-hex"))
            .unwrap();
        let caret = field.caret.expect("Focused hex field has a caret");
        assert!((caret[1] + caret[3] / 2. - (field.rect[1] + field.rect[3] / 2.)).abs() <= 0.6);
    }
}

#[test]
fn caption_editor_scrolls_long_text_inside_its_frame() {
    let mut rt = runtime((980., 820.), false);
    add(&mut rt, "Text caption");
    let before = rect(&rt, "step-1");
    let text = (0..12)
        .map(|i| format!("Line {i}"))
        .collect::<Vec<_>>()
        .join("\n");
    enter(&mut rt, "text-1", &text);
    assert_eq!(rt.state.fields[&1][0].text, text);
    let after = rect(&rt, "step-1");
    assert_eq!(before, after, "Caption editing must not grow its card");
    let editor = rt
        .elements()
        .into_iter()
        .find(|e| e.key.as_deref() == Some("text-1"))
        .unwrap();
    assert!(
        editor.rect[3] > editor.visible[3],
        "Long caption must scroll within the viewport"
    );
    let caret = editor.caret.expect("Caption stays focused after applying");
    assert!(
        caret[1] >= editor.visible[1] - 1.
            && caret[1] + caret[3] <= editor.visible[1] + editor.visible[3] + 1.,
        "Caption caret must stay visible: {caret:?}, visible {:?}",
        editor.visible
    );
}
