use super::*;

#[test]
fn color_picker_stages_cancels_validates_hex_and_supports_keyboard_adjustment() {
    let mut rt = runtime((980., 820.), false);
    add(&mut rt, "Color tint");
    let before = rt.state.cards[0].operation.clone();
    click(&mut rt, "color-1");
    enter(&mut rt, "color-hex", "bad hex");
    assert!(rt.state.color.draft.is_some());
    assert_eq!(rt.state.cards[0].operation, before);
    enter(&mut rt, "color-hex", "#0088CC");
    assert!(rt.state.color.draft.is_none());
    assert!(matches!(
        rt.state.cards[0].operation,
        Operation::ColorTint {
            red: 0,
            green: 136,
            blue: 204,
            ..
        }
    ));
    let applied = rt.state.cards[0].operation.clone();
    click(&mut rt, "color-1");
    let frame = rt.state.frame;
    click(&mut rt, "color-hue");
    rt.key(KeyEvent {
        key: Key::Right,
        mods: Default::default(),
    });
    rt.frame(0.01);
    assert_eq!(rt.state.frame, frame);
    assert_ne!(rt.state.color.draft.as_ref().unwrap().hex.text, "#0088CC");
    click(&mut rt, "color-cancel");
    assert_eq!(rt.state.cards[0].operation, applied);
    click(&mut rt, "color-1");
    rt.key(KeyEvent {
        key: Key::Escape,
        mods: Default::default(),
    });
    rt.frame(0.01);
    assert!(rt.state.color.draft.is_none());
    click(&mut rt, "delete-1");
    add(&mut rt, "Color balance");
    assert!(rt.find("red-2").is_some());
    assert!(rt.find("color-2").is_none());
}

#[test]
fn preview_sampling_fallback_rejects_transparency_and_letterboxing() {
    let mut rt = runtime((980., 820.), false);
    add(&mut rt, "Color tint");
    rt.state.playing = true;
    rt.invalidate();
    rt.frame(0.01);
    rt.state.open_color(1, 0);
    rt.state.begin_color_sampling(None);
    rt.invalidate();
    rt.frame(0.01);
    assert!(!rt.state.playing);
    assert!(matches!(
        rt.state.color.draft.as_ref().unwrap().mode,
        view::color::Mode::Sampling(None)
    ));
    let [x, y, w, h] = rect(&rt, "image");
    let (iw, ih) = rt.state.displayed.as_ref().unwrap().frames[rt.state.frame]
        .pixels
        .dimensions();
    let scale = (w / iw as f32).min(h / ih as f32);
    let ox = x + (w - iw as f32 * scale) / 2.;
    let oy = y + (h - ih as f32 * scale) / 2.;
    rt.pointer_down(x + 2., y + 2.);
    rt.pointer_up(x + 2., y + 2.);
    rt.frame(0.01);
    assert!(matches!(
        rt.state.color.draft.as_ref().unwrap().mode,
        view::color::Mode::Sampling(None)
    ));
    rt.pointer_down(ox + 2. * scale, oy + 2. * scale);
    rt.pointer_up(ox + 2. * scale, oy + 2. * scale);
    rt.frame(0.01);
    assert_eq!(
        view::color::sample_hint(&rt.state),
        Some("Transparent pixel · try another")
    );
    let expected = rt.state.displayed.as_ref().unwrap().frames[rt.state.frame]
        .pixels
        .get_pixel(100, 50)
        .0;
    rt.pointer_down(ox + 100.5 * scale, oy + 50.5 * scale);
    rt.pointer_up(ox + 100.5 * scale, oy + 50.5 * scale);
    rt.frame(0.05);
    assert!(matches!(
        rt.state.color.draft.as_ref().unwrap().mode,
        view::color::Mode::Panel
    ));
    assert_eq!(
        rt.state.color.draft.as_ref().unwrap().hex.text,
        format!("#{:02X}{:02X}{:02X}", expected[0], expected[1], expected[2])
    );
    click(&mut rt, "color-apply");
    assert!(rt.state.playing);
    assert!(
        matches!(rt.state.cards[0].operation, Operation::ColorTint { red, green, blue, .. } if [red,green,blue] == expected[..3])
    );
}

#[test]
fn system_sample_results_are_staged_and_late_results_cannot_modify_another_card() {
    let mut rt = runtime((980., 820.), false);
    add(&mut rt, "Color tint");
    click(&mut rt, "color-1");
    let before = rt.state.cards[0].operation.clone();
    let (sender, receiver) = mpsc::channel();
    rt.state.color.draft.as_mut().unwrap().mode = view::color::Mode::Sampling(Some(receiver));
    sender.send(Ok(Some([12, 34, 56]))).unwrap();
    rt.invalidate();
    rt.frame(0.05);
    assert_eq!(rt.state.cards[0].operation, before);
    assert_eq!(rt.state.color.draft.as_ref().unwrap().hex.text, "#0C2238");
    click(&mut rt, "color-apply");
    assert!(matches!(
        rt.state.cards[0].operation,
        Operation::ColorTint {
            red: 12,
            green: 34,
            blue: 56,
            ..
        }
    ));
    click(&mut rt, "color-1");
    let (sender, receiver) = mpsc::channel();
    rt.state.color.draft.as_mut().unwrap().mode = view::color::Mode::Sampling(Some(receiver));
    sender.send(Ok(None)).unwrap();
    rt.invalidate();
    rt.frame(0.05);
    assert_eq!(rt.state.color.draft.as_ref().unwrap().hex.text, "#0C2238");
    click(&mut rt, "color-cancel");
    click(&mut rt, "color-1");
    let (sender, receiver) = mpsc::channel();
    rt.state.color.draft.as_mut().unwrap().mode = view::color::Mode::Sampling(Some(receiver));
    rt.state.remove(1);
    assert!(sender.send(Ok(Some([255, 0, 0]))).is_err());
    settle(&mut rt);
    assert!(rt.state.color.draft.is_none());
    assert!(rt.state.cards.is_empty());
}

#[test]
fn compact_color_picker_keeps_apply_and_cancel_inside_the_window() {
    let mut rt = runtime((700., 400.), false);
    add(&mut rt, "Color tint");
    click(&mut rt, "color-1");
    assert!(rt.find("color-preview").is_none());
    assert!(rt.find("color-screen").is_none());
    for key in [
        "color-square",
        "color-hue",
        "color-hex",
        "color-sample",
        "color-cancel",
        "color-apply",
    ] {
        let [x, y, w, h] = rect(&rt, key);
        assert!(
            x >= 0. && y >= 0. && x + w <= 700. && y + h <= 400.,
            "{key} outside the window: {:?}",
            [x, y, w, h]
        );
    }
}

#[test]
fn color_picker_prefers_below_and_flips_above_when_the_window_is_short() {
    for size in [(980., 820.), (700., 400.)] {
        let mut rt = runtime(size, false);
        scenes::caption_scene(&mut rt.state);
        rt.invalidate();
        rt.frame(0.1);
        click(&mut rt, "color-2");
        let [x, y, _, h] = rect(&rt, "color-2");
        let panel = rt
            .elements()
            .into_iter()
            .find(|el| el.role == "dialog" && el.label.as_deref() == Some("Choose color"))
            .unwrap()
            .rect;
        assert!(
            (panel[0] - x).abs() <= 1.,
            "Align the picker with its trigger: {panel:?}"
        );
        if size.1 > 500. {
            assert!(
                panel[1] >= y + h,
                "Prefer opening below: {panel:?}, trigger {y} + {h}"
            );
        } else {
            assert!(
                panel[1] + panel[3] <= y,
                "Flip above when below cannot fit: {panel:?}, trigger {y}"
            );
        }
        for key in [
            "color-square",
            "color-hue",
            "color-hex",
            "color-cancel",
            "color-apply",
        ] {
            let [x, y, w, h] = rect(&rt, key);
            assert!(
                x >= 0. && y >= 0. && x + w <= size.0 && y + h <= size.1,
                "{key} must remain usable: {:?}",
                [x, y, w, h]
            );
        }
    }
}
