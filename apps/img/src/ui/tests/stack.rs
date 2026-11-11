use super::*;

#[test]
fn menu_resize_reorder_eye_delete_and_pinned_preview() {
    for dark in [false, true] {
        let mut rt = runtime((980., 820.), dark);
        assert_eq!(
            rt.elements()
                .into_iter()
                .find(|e| e.key.as_deref() == Some("window"))
                .unwrap()
                .fill,
            rune::Color::WHITE
        );
        add(&mut rt, "Resize");
        assert_eq!(
            rt.state.outputs.get(0).unwrap().frames[0]
                .pixels
                .dimensions(),
            (320, 240)
        );
        enter(&mut rt, "width-1", "80");
        enter(&mut rt, "height-1", "60");
        assert_eq!(
            rt.state.outputs.get(0).unwrap().frames[0]
                .pixels
                .dimensions(),
            (80, 60)
        );
        add(&mut rt, "Reverse");
        click(&mut rt, "preview-1");
        click(&mut rt, "up-2");
        assert_eq!(rt.state.cards[0].id, 2);
        assert_eq!(rt.state.selected, Some(1));
        assert_eq!(rt.state.displayed.as_ref().unwrap().frames[0].delay_ms, 350);
        click(&mut rt, "eye-1");
        assert!(!rt.state.cards[1].enabled);
        assert!(Arc::ptr_eq(
            rt.state.outputs.get(0).unwrap(),
            rt.state.outputs.get(1).unwrap()
        ));
        assert!(
            rt.elements()
                .into_iter()
                .find(|e| e.key.as_deref() == Some("step-1"))
                .unwrap()
                .opacity
                < 0.5
        );
        click(&mut rt, "delete-1");
        assert_eq!(rt.state.selected, None);
        click(&mut rt, "delete-2");
        assert!(rt.state.cards.is_empty());
        assert!(rt.state.ready());
    }
}

#[test]
fn whole_card_drag_preserves_grab_point_and_supports_cancel_and_drop() {
    let mut rt = runtime((980., 820.), false);
    add(&mut rt, "Resize");
    add(&mut rt, "Reverse");
    click(&mut rt, "preview-1");
    for outcome in ["escape", "outside", "drop"] {
        let original = rect(&rt, "step-1");
        let start = rt.find("drag-1").unwrap();
        let target_y = rect(&rt, "step-2")[1] + 35.;
        let target_x = if outcome == "outside" { 700. } else { start.0 };
        rt.pointer_down(start.0, start.1);
        rt.frame(0.01);
        rt.pointer_move(target_x, target_y);
        rt.frame(0.016);
        assert!(rt.state.dragging.is_some());
        let lifted = rect(&rt, "held-1");
        assert_eq!(rect(&rt, "step-1")[1], original[1]);
        assert!((lifted[1] - original[1] - (target_y - start.1)).abs() < 1.);
        assert!((lifted[2] - original[2]).abs() < 0.1);
        if outcome == "escape" {
            rt.key(KeyEvent {
                key: Key::Escape,
                mods: Default::default(),
            });
            rt.frame(0.01);
            assert!(rt.state.dragging.is_none());
        }
        rt.pointer_up(target_x, target_y);
        rt.frame(0.016);
        settle(&mut rt);
        assert_eq!(rt.state.cards[0].id, if outcome == "drop" { 2 } else { 1 });
        assert_eq!(rt.state.selected, Some(1));
    }
}

#[test]
fn dragging_near_the_edge_scrolls_and_keeps_the_grip_under_the_pointer() {
    let mut rt = runtime((700., 400.), false);
    for _ in 0..7 {
        rt.state.add(Operation::Reverse);
        settle(&mut rt);
    }
    let start = rt.find("drag-1").unwrap();
    rt.pointer_down(start.0, start.1);
    rt.frame(0.01);
    rt.pointer_move(start.0, 382.);
    rt.frame(0.016);
    for _ in 0..35 {
        rt.frame(1. / 60.);
    }
    assert!(
        rt.state.list.position.get()[0] > 20.,
        "Drag should scroll the list"
    );
    let held = rect(&rt, "held-1");
    let grip = (held[0] + 16., held[1] + 20.);
    assert!(
        (grip.1 - 382.).abs() < 2.,
        "Grab point moved away from pointer: {grip:?}"
    );
    rt.key(KeyEvent {
        key: Key::Escape,
        mods: Default::default(),
    });
    rt.frame(0.01);
    assert!(rt.state.dragging.is_none());
    assert_eq!(rt.state.cards[0].id, 1);
}

#[test]
fn disclosures_and_intermediate_edits_keep_the_current_preview() {
    let mut rt = runtime((980., 820.), false);
    add(&mut rt, "Resize");
    enter(&mut rt, "width-1", "96");
    add(&mut rt, "Text caption");
    assert!(rt.find("width-1").is_none());
    assert!(rt.find("text-2").is_some());
    assert!(rt.find("x-2").is_none());
    assert!(rt.find("outline-2").is_none());
    click(&mut rt, "position-2");
    assert!(rt.find("x-2").is_some());
    assert!(rt.find("align-2-1-1").is_some());
    click(&mut rt, "appearance-2");
    assert!(rt.find("outline-2").is_some());
    click(&mut rt, "collapse-1");
    assert_eq!(rt.state.selected, None);
    let preview = rt.state.displayed.clone().unwrap();
    assert_eq!(rt.state.fields[&1][0].text, "96");
    enter(&mut rt, "width-1", "120");
    assert_eq!(rt.state.selected, None);
    assert!(!Arc::ptr_eq(rt.state.displayed.as_ref().unwrap(), &preview));
    assert_eq!(
        rt.state.displayed.as_ref().unwrap().frames[0]
            .pixels
            .width(),
        120
    );
    click(&mut rt, "preview-2");
    click(&mut rt, "collapse-1");
    click(&mut rt, "collapse-1");
    assert_eq!(rt.state.selected, Some(2));
    click(&mut rt, "collapse-all");
    assert!(rt.find("width-1").is_none());
    assert!(rt.find("text-2").is_none());
    click(&mut rt, "collapse-all");
    assert!(rt.find("width-1").is_some());
    assert!(rt.find("text-2").is_some());
    add(&mut rt, "Image / GIF overlay");
    assert!(rt.find("path-3").is_some());
    assert!(rt.find("x-3").is_none());
    click(&mut rt, "position-3");
    assert!(rt.find("x-3").is_some());
}

#[test]
fn dropped_cards_start_from_the_original_slot_and_honor_reduced_motion() {
    for reduced in [false, true] {
        let mut rt = runtime((980., 820.), false);
        rt.set_system_reduced_motion(reduced);
        rt.frame(0.);
        add(&mut rt, "Negate");
        add(&mut rt, "Reverse");
        let original = rect(&rt, "step-1");
        let start = rt.find("drag-1").unwrap();
        let target = rect(&rt, "step-2");
        let pointer = (start.0, target[1] + target[3] - 2.);
        rt.pointer_down(start.0, start.1);
        rt.frame(0.);
        rt.pointer_move(pointer.0, pointer.1);
        rt.frame(0.016);
        assert_eq!(rect(&rt, "step-1")[1], original[1]);
        assert!(rt.find("held-1").is_some());
        assert!(rt.find("drop-marker").is_some());
        let held_y = rect(&rt, "held-1")[1];
        rt.pointer_up(pointer.0, pointer.1);
        rt.frame(0.);
        assert_eq!(rt.state.cards[1].id, 1);
        let released_y = rect(&rt, "step-1")[1];
        if reduced {
            assert!((released_y - target[1]).abs() < 1.);
        } else {
            assert!(
                (released_y - original[1]).abs() < 1.,
                "Card started at {released_y}, original {}, held {held_y}",
                original[1]
            );
            rt.frame(0.08);
            let moving_y = rect(&rt, "step-1")[1];
            assert!(moving_y > original[1] && moving_y < target[1] + 1.);
        }
        settle(&mut rt);
        assert!((rect(&rt, "step-1")[1] - target[1]).abs() < 1.);
    }
}
