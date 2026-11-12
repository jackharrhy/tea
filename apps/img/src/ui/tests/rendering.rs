use super::*;

#[test]
fn frame_strip_seek_transport_and_keyboard() {
    let mut rt = runtime((700., 400.), false);
    click(&mut rt, "frames");
    click(&mut rt, "frame-2");
    assert_eq!(rt.state.frame, 2);
    assert!(!rt.state.playing);
    click(&mut rt, "previous");
    assert_eq!(rt.state.frame, 1);
    click(&mut rt, "next");
    assert_eq!(rt.state.frame, 2);
    click(&mut rt, "play");
    assert!(rt.state.playing);
    rt.frame(0.09);
    assert_ne!(rt.state.frame, 2);
    click(&mut rt, "frames");
    assert!(!rt.state.frames_open);
    click(&mut rt, "actual");
    assert!(rt.state.actual_size);
    click(&mut rt, "fit");
    assert!(!rt.state.actual_size);
}

#[test]
fn processing_keeps_preview_and_layout_and_rejects_invalid_dimensions() {
    let mut rt = runtime((980., 820.), false);
    add(&mut rt, "Resize");
    let preview = rt.state.displayed.clone().unwrap();
    let before = rect(&rt, "step-1");
    let export = rect(&rt, "export");
    // Hold a worker completion so this check does not race a fast resize.
    let (sender, receiver) = mpsc::channel();
    rt.state.worker = worker::Worker::receiving(worker::Kind::Io, receiver);
    rt.invalidate();
    rt.frame(0.01);
    assert!(Arc::ptr_eq(rt.state.displayed.as_ref().unwrap(), &preview));
    assert_eq!(before, rect(&rt, "step-1"));
    assert_eq!(export, rect(&rt, "export"));
    sender
        .send(Ok(Completed::Processed(rt.state.outputs.clone())))
        .unwrap();
    settle(&mut rt);
    rt.state.fields.get_mut(&1).unwrap()[0] = TextEdit::new("0");
    rt.state.queue_field(1, 0);
    rt.frame(0.01);
    assert!(rt.state.status.contains("1 to 4096"));
    assert!(Arc::ptr_eq(rt.state.displayed.as_ref().unwrap(), &preview));
}

#[test]
fn native_dialog_routes_import_negate_and_export_through_real_engine() {
    let mut rt = runtime((980., 820.), false);
    click(&mut rt, "open");
    assert!(rt.file_dialog().is_some());
    rt.resolve_file_dialog(Some(PathBuf::from(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/samples/blue-block.gif"
    ))))
    .unwrap();
    rt.frame(0.01);
    settle(&mut rt);
    assert_eq!(rt.state.source.as_ref().unwrap().frames.len(), 12);
    add(&mut rt, "Negate");
    let output = rt.state.displayed.clone().unwrap();
    let original = rt.state.source.as_ref().unwrap().frames[0]
        .pixels
        .get_pixel(100, 100)
        .0;
    assert_eq!(
        output.frames[0].pixels.get_pixel(100, 100).0,
        [
            255 - original[0],
            255 - original[1],
            255 - original[2],
            original[3]
        ]
    );
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("export.gif");
    click(&mut rt, "export");
    assert!(rt.file_dialog().is_some());
    rt.resolve_file_dialog(Some(path.clone())).unwrap();
    rt.frame(0.01);
    settle(&mut rt);
    let decoded = Animation::load(&path).unwrap();
    assert_eq!(decoded.repeat, output.repeat);
    assert_eq!(decoded.frames.len(), output.frames.len());
    for (a, b) in decoded.frames.iter().zip(&output.frames) {
        assert_eq!(a.delay_ms, b.delay_ms);
        assert_eq!(a.pixels.dimensions(), b.pixels.dimensions());
    }
}

#[test]
fn divider_resizes_and_thumbnails_are_cached_only_when_visible() {
    let mut rt = runtime((980., 820.), false);
    let (x, y) = rt.find("pane-divider").unwrap();
    rt.pointer_down(x, y);
    rt.frame(0.01);
    rt.pointer_move(x + 40., y);
    rt.frame(0.016);
    rt.pointer_up(x + 40., y);
    rt.frame(0.016);
    assert_eq!(rt.state.pane_width, 400.);
    click(&mut rt, "frames");
    assert!(rt.state.thumbnails.borrow().len() < rt.state.displayed.as_ref().unwrap().frames.len());
    click(&mut rt, "frame-2");
    rt.key(KeyEvent {
        key: Key::Right,
        mods: Default::default(),
    });
    rt.frame(0.01);
    assert_eq!(rt.state.frame, 3);
    assert!(!rt.state.playing);
}

#[test]
fn checkerboard_compositing_does_not_change_export_pixels() {
    let image =
        image::RgbaImage::from_raw(3, 1, vec![255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 128]).unwrap();
    let before = image.clone();
    let shown = preview_rgba(&image);
    assert_eq!(&shown[..4], &[255, 0, 0, 255]);
    assert_eq!(&shown[4..8], &[248, 248, 248, 255]);
    assert_eq!(&shown[8..], &[124, 124, 124, 255]);
    assert_eq!(image, before);
}

#[test]
fn unavailable_controls_block_input_instead_of_only_announcing_disabled() {
    let mut rt = runtime((980., 820.), false);
    add(&mut rt, "Reverse");
    for key in ["up-1", "down-1"] {
        let [x, y, w, h] = rect(&rt, key);
        rt.pointer_down(x + w / 2., y + h / 2.);
        rt.pointer_up(x + w / 2., y + h / 2.);
        rt.frame(0.01);
        assert!(!rt.state.worker.busy());
        assert_eq!(rt.state.cards[0].id, 1);
    }
    let (sender, receiver) = mpsc::channel();
    rt.state.worker = worker::Worker::receiving(worker::Kind::Io, receiver);
    rt.invalidate();
    rt.frame(0.01);
    for key in ["eye-1", "delete-1", "add", "export"] {
        let [x, y, w, h] = rect(&rt, key);
        rt.pointer_down(x + w / 2., y + h / 2.);
        rt.pointer_up(x + w / 2., y + h / 2.);
        rt.frame(0.01);
        assert_eq!(rt.state.cards.len(), 1);
        assert!(rt.state.cards[0].enabled);
        assert!(!rt.state.picker.open);
        assert!(rt.file_dialog().is_none());
    }
    sender
        .send(Ok(Completed::Processed(rt.state.outputs.clone())))
        .unwrap();
    settle(&mut rt);
}

#[test]
fn importing_the_first_gif_keeps_the_stack_actions_in_place() {
    let size = (980., 820.);
    let mut rt = App::new(AppSpec {
        fonts: font_preview::FONTS,
        poll: Some(poll),
        ..AppSpec::new("img", size, State::empty, view::view)
    })
    .headless_runtime(size, Env::new(false, 1.));
    rt.frame(0.);
    let before = [rect(&rt, "import"), rect(&rt, "open"), rect(&rt, "add")];
    rt.state
        .request_io(worker::IoJob::Load(PathBuf::from(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/samples/blue-block.gif"
        ))));
    rt.invalidate();
    rt.frame(0.);
    settle(&mut rt);
    let after = [rect(&rt, "import"), rect(&rt, "open"), rect(&rt, "add")];
    assert_eq!(before[0], after[0]);
    assert_eq!(before[2], after[2]);
    assert_eq!(
        [before[1][0], before[1][1], before[1][3]],
        [after[1][0], after[1][1], after[1][3]]
    );
}

#[test]
fn blank_field_area_accepts_clicks_during_playback_and_render_edits_coalesce() {
    let mut rt = runtime((980., 820.), false);
    add(&mut rt, "Resize");
    rt.state.playing = true;
    rt.invalidate();
    rt.frame(0.01);
    let [x, y, w, h] = rect(&rt, "width-1");
    assert!(
        w > 90. && h >= 24.,
        "Textbox must fill its visible box: {w} × {h}"
    );
    for _ in 0..2 {
        rt.pointer_down(x + w - 2., y + h - 2.);
        rt.pointer_up(x + w - 2., y + h - 2.);
        rt.frame(0.01);
    }
    assert!(rt.state.fields[&1][0].focused);
    let cached = rt.state.outputs.clone();
    let displayed = rt.state.displayed.clone().unwrap();
    let (sender, receiver) = mpsc::channel();
    rt.state.worker = worker::Worker::receiving(worker::Kind::Render, receiver);
    rt.invalidate();
    rt.frame(0.01);
    for width in ["90", "64"] {
        for _ in 0..2 {
            rt.pointer_down(x + w - 2., y + h - 2.);
            rt.pointer_up(x + w - 2., y + h - 2.);
            rt.frame(0.01);
        }
        rt.key(KeyEvent {
            key: Key::Command('a'),
            mods: Default::default(),
        });
        rt.key(KeyEvent {
            key: Key::Text(width.into()),
            mods: Default::default(),
        });
        rt.frame(0.01);
        rt.key(KeyEvent {
            key: Key::Enter,
            mods: Default::default(),
        });
        rt.frame(0.01);
        assert!(Arc::ptr_eq(
            rt.state.displayed.as_ref().unwrap(),
            &displayed
        ));
    }
    assert_eq!(rt.state.fields[&1][0].text, "64");
    sender.send(Ok(Completed::Processed(cached))).unwrap();
    settle(&mut rt);
    assert!(rt.state.ready());
    assert_eq!(
        rt.state.final_output().unwrap().frames[0].pixels.width(),
        64
    );
}

#[test]
fn selecting_an_uncached_card_renders_it_without_losing_the_final_export() {
    let mut rt = runtime((980., 820.), false);
    for _ in 0..4 {
        rt.state.add(Operation::Negate);
        settle(&mut rt);
    }
    assert!(rt.state.outputs.get(0).is_none());
    let final_before = rt.state.final_output().unwrap();
    rt.state.select(1);
    settle(&mut rt);
    assert_eq!(
        rt.state.displayed.as_ref().unwrap().frames[0].pixels,
        rt.state.outputs.get(0).unwrap().frames[0].pixels
    );
    assert!(Arc::ptr_eq(
        &final_before,
        &rt.state.final_output().unwrap()
    ));
}

#[test]
fn replacing_source_keeps_effects_and_can_be_undone_and_redone() {
    let mut rt = runtime((980., 820.), false);
    add(&mut rt, "Resize");
    enter(&mut rt, "width-1", "80");
    add(&mut rt, "Negate");
    rt.state.toggle(2);
    settle(&mut rt);
    click(&mut rt, "preview-1");
    click(&mut rt, "collapse-0");
    let source = rt.state.source.clone().unwrap();
    let cards = rt.state.cards.clone();
    let collapsed = rt.state.collapsed.clone();
    let next_id = rt.state.next_id;
    let name = rt.state.name.clone();
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("replacement.gif");
    Animation {
        frames: [[240, 30, 60, 255], [20, 210, 90, 255]]
            .into_iter()
            .map(|color| img::Frame {
                pixels: image::RgbaImage::from_pixel(64, 48, image::Rgba(color)).into(),
                delay_ms: 70,
            })
            .collect(),
        repeat: gif::Repeat::Finite(2),
    }
    .save(&path)
    .unwrap();
    click(&mut rt, "open");
    rt.resolve_file_dialog(Some(path)).unwrap();
    rt.frame(0.01);
    settle(&mut rt);
    assert_eq!(rt.state.cards, cards);
    assert_eq!(rt.state.collapsed, collapsed);
    assert_eq!(rt.state.next_id, next_id);
    assert_eq!(rt.state.selected, Some(1));
    assert_eq!(rt.state.name, "replacement.gif");
    assert_eq!(
        rt.state.source.as_ref().unwrap().frames[0]
            .pixels
            .dimensions(),
        (64, 48)
    );
    assert_eq!(
        rt.state.displayed.as_ref().unwrap().frames[0]
            .pixels
            .width(),
        80
    );
    assert_eq!(rt.state.history.undo_label(), Some("Replace GIF"));
    rt.state.undo();
    settle(&mut rt);
    assert!(Arc::ptr_eq(rt.state.source.as_ref().unwrap(), &source));
    assert_eq!(rt.state.name, name);
    assert_eq!(rt.state.cards, cards);
    rt.state.redo();
    settle(&mut rt);
    assert_eq!(rt.state.name, "replacement.gif");
    assert_eq!(rt.state.cards, cards);
}

#[test]
fn failed_source_replacement_after_queued_edits_keeps_the_latest_render_exportable() {
    let mut rt = runtime((980., 820.), false);
    add(&mut rt, "Resize");
    let source = rt.state.source.clone().unwrap();
    let output = rt.state.outputs.clone();
    let (sender, receiver) = mpsc::channel();
    rt.state.worker = worker::Worker::receiving(worker::Kind::Render, receiver);
    rt.state.fields.get_mut(&1).unwrap()[0] = TextEdit::new("80");
    rt.state.apply_parameters(1, &[0]);
    let temp = tempfile::tempdir().unwrap();
    rt.state
        .request_io(worker::IoJob::Load(temp.path().join("missing.gif")));
    assert!(!rt.state.editable());
    sender.send(Ok(Completed::Processed(output))).unwrap();
    rt.frame(0.01);
    let deadline = Instant::now() + Duration::from_secs(10);
    while rt.state.worker.busy() {
        assert!(
            Instant::now() < deadline,
            "Queued source replacement timed out"
        );
        std::thread::sleep(Duration::from_millis(1));
        rt.frame(0.01);
    }
    assert!(rt.state.status.starts_with("Error:"));
    assert!(Arc::ptr_eq(rt.state.source.as_ref().unwrap(), &source));
    assert!(
        rt.state.ready(),
        "A failed replacement must leave the previous document exportable"
    );
    assert_eq!(
        rt.state.final_output().unwrap().frames[0].pixels.width(),
        80
    );
}
