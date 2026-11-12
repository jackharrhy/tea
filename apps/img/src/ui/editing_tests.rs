use super::tests::{add, click, double_click, enter, runtime, settle};
use super::*;
use rune::{ClipboardContent, KeyEvent, Mods};

fn key(rt: &mut rune::Runtime<State>, key: char, shift: bool) {
    rt.key(KeyEvent {
        key: Key::Command(key),
        mods: Mods {
            cmd: true,
            shift,
            ..Default::default()
        },
    });
    rt.frame(0.05);
    settle(rt);
}
#[test]
fn history_restores_stack_parameters_bypass_order_and_deleted_card_fields() {
    let mut rt = runtime((980., 820.), false);
    assert!(rt.state.history.undo_label().is_none());
    add(&mut rt, "Resize");
    enter(&mut rt, "width-1", "80");
    let resize = rt.state.cards.clone();
    add(&mut rt, "Reverse");
    click(&mut rt, "up-2");
    let reordered = rt.state.cards.clone();
    click(&mut rt, "eye-1");
    let bypassed = rt.state.cards.clone();
    click(&mut rt, "delete-1");
    click(&mut rt, "undo");
    assert_eq!(rt.state.cards, bypassed);
    assert_eq!(rt.state.fields[&1][0].text, "80");
    click(&mut rt, "undo");
    assert_eq!(rt.state.cards, reordered);
    click(&mut rt, "undo");
    assert_eq!(rt.state.cards[0].id, 1);
    click(&mut rt, "undo");
    assert_eq!(rt.state.cards, resize);
    click(&mut rt, "undo");
    assert_eq!(rt.state.fields[&1][0].text, "320");
    click(&mut rt, "undo");
    assert!(rt.state.cards.is_empty());
    for _ in 0..6 {
        click(&mut rt, "redo");
    }
    assert_eq!(rt.state.cards.len(), 1);
    click(&mut rt, "undo");
    add(&mut rt, "Negate");
    assert!(rt.state.history.redo_label().is_none());
    assert!(
        rt.state.cards.last().unwrap().id > 2,
        "Restored ids must never be reused"
    );
}
#[test]
fn field_typing_undo_is_local_and_submitted_changes_use_document_history() {
    let mut rt = runtime((980., 820.), false);
    add(&mut rt, "Resize");
    double_click(&mut rt, "width-1");
    key(&mut rt, 'a', false);
    rt.key(KeyEvent {
        key: Key::Text("80".into()),
        mods: Default::default(),
    });
    rt.frame(0.05);
    key(&mut rt, 'z', false);
    assert_eq!(rt.state.fields[&1][0].text, "320");
    assert_eq!(rt.state.cards.len(), 1);
    key(&mut rt, 'z', true);
    assert_eq!(rt.state.fields[&1][0].text, "80");
    rt.key(KeyEvent {
        key: Key::Enter,
        mods: Default::default(),
    });
    rt.frame(0.05);
    settle(&mut rt);
    assert!(matches!(
        rt.state.cards[0].operation,
        Operation::Resize { width: 80, .. }
    ));
    key(&mut rt, 'z', false);
    assert!(matches!(
        rt.state.cards[0].operation,
        Operation::Resize { width: 320, .. }
    ));
    key(&mut rt, 'z', true);
    assert!(matches!(
        rt.state.cards[0].operation,
        Operation::Resize { width: 80, .. }
    ));
}
#[test]
fn clipboard_operations_roundtrip_every_kind_and_paste_is_one_atomic_edit() {
    let all: Vec<_> = Operation::catalog()
        .into_iter()
        .enumerate()
        .map(|(index, operation)| Card {
            id: index as u64 + 1,
            operation,
            enabled: index % 2 == 0,
        })
        .collect();
    // The catalog exceeds the per-stack limit, so exercise individual payloads too.
    for card in &all {
        let encoded = clipboard::encode(std::slice::from_ref(card)).unwrap();
        let decoded = clipboard::decode(&encoded).unwrap();
        assert_eq!(decoded, [(card.operation.clone(), card.enabled)]);
    }
    assert!(
        clipboard::decode(r#"{"format":"img.operations","version":9,"operations":[]}"#).is_err()
    );
    assert!(clipboard::decode(&"x".repeat(1024 * 1024 + 1)).is_err());
    assert!(clipboard::decode(r#"{"format":"img.operations","version":1,"operations":[{"kind":"Resize","values":["0","1"],"enabled":true}]}"#).is_err());
    let mut rt = runtime((980., 820.), false);
    add(&mut rt, "Negate");
    add(&mut rt, "Reverse");
    let original = rt.state.cards.clone();
    let payload = clipboard::encode(&original).unwrap();
    rt.state.paste_content(&ClipboardContent::new(payload));
    rt.frame(0.05);
    settle(&mut rt);
    assert_eq!(rt.state.cards.len(), 4);
    assert_eq!(rt.state.cards[2].operation, original[0].operation);
    assert_eq!(rt.state.cards[3].operation, original[1].operation);
    assert_ne!(rt.state.cards[2].id, original[0].id);
    click(&mut rt, "undo");
    assert_eq!(rt.state.cards, original);
    click(&mut rt, "redo");
    assert_eq!(rt.state.cards.len(), 4);
    let before = rt.state.cards.clone();
    rt.state.paste_content(&ClipboardContent::new(
        r#"{"format":"img.operations","version":0,"operations":[]}"#,
    ));
    assert_eq!(rt.state.cards, before);
    assert!(rt.state.status.starts_with("Error:"));
}
#[test]
fn system_clipboard_copy_cut_paste_and_duplicate_respect_focus_and_history() {
    let board = rune::clipboard::memory();
    let mut rt = runtime((980., 820.), false);
    rt.use_clipboard(&board);
    add(&mut rt, "Reverse");
    key(&mut rt, 'c', false);
    assert_eq!(
        clipboard::decode(board.content().unwrap().text()).unwrap(),
        [(Operation::Reverse, true)]
    );
    key(&mut rt, 'x', false);
    assert!(rt.state.cards.is_empty());
    key(&mut rt, 'v', false);
    assert_eq!(rt.state.cards.len(), 1);
    key(&mut rt, 'd', false);
    assert_eq!(rt.state.cards.len(), 2);
    key(&mut rt, 'z', false);
    assert_eq!(rt.state.cards.len(), 1);
    add(&mut rt, "Text caption");
    click(&mut rt, "text-4");
    key(&mut rt, 'a', false);
    key(&mut rt, 'c', false);
    assert_eq!(board.text().unwrap().as_str(), "Text");
    board.set_text("Caption from clipboard");
    // Native Cmd+V requests a paste at the physical-key boundary before logical keys.
    rt.update(|_, tx| tx.request_paste());
    rt.frame(0.05);
    assert_eq!(rt.state.fields[&4][0].text, "Caption from clipboard");
    key(&mut rt, 'c', true);
    assert!(board.content().unwrap().image().is_some());
    assert!(
        rt.state.fields[&4][0].focused,
        "Copying a preview frame must preserve the typing focus"
    );
    assert_eq!(rt.state.fields[&4][0].text, "Caption from clipboard");
}
#[test]
fn undo_while_rendering_queues_latest_state_without_publishing_stale_outputs() {
    let mut rt = runtime((980., 820.), false);
    add(&mut rt, "Resize");
    let stable = rt.state.cards.clone();
    let stable_output = rt.state.outputs.clone();
    let (sender, receiver) = mpsc::channel();
    rt.state.worker = worker::Worker::receiving(worker::Kind::Render, receiver);
    rt.state.fields.get_mut(&1).unwrap()[0] = TextEdit::new("80");
    rt.state.apply_parameters(1, &[0]);
    rt.state.undo();
    assert_eq!(rt.state.cards, stable);
    sender
        .send(Ok(Completed::Processed(stable_output)))
        .unwrap();
    rt.frame(0.1);
    settle(&mut rt);
    assert!(rt.state.ready());
    assert_eq!(
        rt.state.final_output().unwrap().frames[0].pixels.width(),
        320
    );
}
#[test]
fn image_clipboard_copies_rgba_and_pastes_a_single_undoable_overlay() {
    let board = rune::clipboard::memory();
    let mut rt = runtime((980., 820.), false);
    rt.use_clipboard(&board);
    key(&mut rt, 'c', true);
    let content = board.content().unwrap();
    assert!(content.image().is_some());
    let input = rt.state.source.clone().unwrap();
    rt.state.paste_content(&content);
    rt.frame(0.1);
    settle(&mut rt);
    assert!(matches!(
        rt.state.cards[0].operation,
        Operation::Overlay { .. }
    ));
    assert_eq!(
        rt.state.final_output().unwrap().frames[0].pixels,
        input.frames[0].pixels
    );
    click(&mut rt, "undo");
    assert!(rt.state.cards.is_empty());
    click(&mut rt, "redo");
    assert!(rt.state.ready());
}

#[test]
fn copied_overlay_embeds_its_asset_and_survives_source_deletion_and_undo() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("asset.png");
    image::RgbaImage::from_pixel(8, 8, image::Rgba([240, 30, 70, 180]))
        .save(&path)
        .unwrap();
    let card = Card {
        id: 1,
        enabled: true,
        operation: Operation::Overlay {
            path: path.to_string_lossy().into(),
            x: 2,
            y: 3,
            width: 0,
            percent: 60.,
        },
    };
    let payload = clipboard::encode(&[card]).unwrap();
    std::fs::remove_file(path).unwrap();
    let mut rt = runtime((980., 820.), false);
    rt.state.paste_content(&ClipboardContent::new(payload));
    rt.frame(0.1);
    settle(&mut rt);
    let stored = if let Operation::Overlay { path, .. } = &rt.state.cards[0].operation {
        PathBuf::from(path)
    } else {
        panic!("Expected overlay");
    };
    assert!(stored.exists());
    let rendered = rt.state.final_output().unwrap().frames[0].pixels.clone();
    click(&mut rt, "undo");
    assert!(rt.state.cards.is_empty());
    assert!(stored.exists(), "Redo retains its image asset");
    click(&mut rt, "redo");
    assert_eq!(rt.state.final_output().unwrap().frames[0].pixels, rendered);
}

#[test]
fn pasting_an_image_into_an_empty_document_can_be_undone_and_redone() {
    let mut png = std::io::Cursor::new(vec![]);
    image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
        8,
        6,
        image::Rgba([90, 120, 250, 170]),
    ))
    .write_to(&mut png, image::ImageFormat::Png)
    .unwrap();
    let image = rune::ClipboardImage::from_png(png.into_inner()).unwrap();
    let mut rt = runtime((980., 820.), false);
    rt.state = State::empty();
    rt.invalidate();
    rt.frame(0.1);
    rt.state
        .paste_content(&ClipboardContent::default().with_image(image));
    rt.frame(0.1);
    settle(&mut rt);
    assert_eq!(
        rt.state.source.as_ref().unwrap().frames[0]
            .pixels
            .dimensions(),
        (8, 6)
    );
    click(&mut rt, "undo");
    assert!(rt.state.source.is_none());
    click(&mut rt, "redo");
    assert_eq!(
        rt.state.source.as_ref().unwrap().frames[0]
            .pixels
            .dimensions(),
        (8, 6)
    );
}

#[test]
fn text_drag_nudges_and_color_apply_are_single_history_actions() {
    let mut rt = runtime((980., 820.), false);
    scenes::caption_scene(&mut rt.state);
    rt.invalidate();
    rt.frame(0.1);
    let original = rt.state.cards[1].operation.clone();
    let (x, y) = rt.find("text-selection").unwrap();
    rt.pointer_down(x, y);
    rt.pointer_move(x + 30., y - 35.);
    rt.frame(0.05);
    rt.pointer_up(x + 30., y - 35.);
    rt.frame(0.05);
    settle(&mut rt);
    let dragged = rt.state.cards[1].operation.clone();
    assert_ne!(dragged, original);
    for _ in 0..5 {
        assert!(rt.state.nudge_text(1, 0));
    }
    rt.frame(0.1);
    settle(&mut rt);
    click(&mut rt, "undo");
    assert_eq!(rt.state.cards[1].operation, dragged);
    click(&mut rt, "undo");
    assert_eq!(rt.state.cards[1].operation, original);
    click(&mut rt, "color-2");
    enter(&mut rt, "color-hex", "#F02C5B");
    assert!(rt.state.color.draft.is_none(), "Enter applies the color");
    assert_ne!(rt.state.cards[1].operation, original);
    click(&mut rt, "undo");
    assert_eq!(rt.state.cards[1].operation, original);
}

#[test]
fn seeded_edit_history_matches_all_recorded_states_in_both_directions() {
    let mut rt = runtime((980., 820.), false);
    let mut seed = 0x1ab4_09d3u64;
    let mut states = vec![rt.state.cards.clone()];
    for _ in 0..45 {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
        match seed % 5 {
            0 | 1 => {
                let op = if seed & 16 == 0 {
                    Operation::Reverse
                } else {
                    Operation::Negate
                };
                rt.state.add(op);
            }
            2 if !rt.state.cards.is_empty() => {
                let id = rt.state.cards[(seed as usize / 16) % rt.state.cards.len()].id;
                rt.state.toggle(id);
            }
            3 if rt.state.cards.len() > 1 => rt.state.move_card(0, rt.state.cards.len() - 1),
            4 if !rt.state.cards.is_empty() => {
                let id = rt.state.cards[0].id;
                rt.state.remove(id);
            }
            _ => continue,
        }
        rt.frame(0.05);
        settle(&mut rt);
        if states.last() != Some(&rt.state.cards) {
            states.push(rt.state.cards.clone());
        }
    }
    for expected in states[..states.len() - 1].iter().rev() {
        rt.state.undo();
        rt.frame(0.05);
        settle(&mut rt);
        assert_eq!(&rt.state.cards, expected);
    }
    for expected in states.iter().skip(1) {
        rt.state.redo();
        rt.frame(0.05);
        settle(&mut rt);
        assert_eq!(&rt.state.cards, expected);
    }
}

#[test]
fn plain_text_pastes_as_a_caption_and_new_operations_preserve_existing_field_drafts() {
    let mut rt = runtime((980., 820.), false);
    add(&mut rt, "Resize");
    rt.state.fields.get_mut(&1).unwrap()[0] = TextEdit::new("123");
    rt.state.local_edits.insert((1, 0));
    rt.state
        .paste_content(&ClipboardContent::new("Hello\nclipboard"));
    rt.frame(0.1);
    settle(&mut rt);
    assert!(
        matches!(&rt.state.cards[1].operation, Operation::Text { text, .. } if text == "Hello\nclipboard")
    );
    assert_eq!(
        rt.state.fields[&1][0].text, "123",
        "Paste must not discard an unsubmitted field in another card"
    );
    assert!(rt.state.local_edits.contains(&(1, 0)));
    click(&mut rt, "undo");
    assert_eq!(rt.state.cards.len(), 1);
    assert_eq!(
        rt.state.fields[&1][0].text, "123",
        "Undoing paste must preserve the unrelated field draft"
    );
}

#[test]
fn replacing_file_sources_preserves_history_and_pasted_assets_do_not_depend_on_the_file() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("file.png");
    image::RgbaImage::from_pixel(12, 8, image::Rgba([220, 180, 70, 255]))
        .save(&path)
        .unwrap();
    let mut rt = runtime((980., 820.), false);
    rt.state
        .paste_content(&ClipboardContent::default().with_files([path.clone()]));
    rt.frame(0.1);
    settle(&mut rt);
    let expected = rt.state.final_output().unwrap().frames[0].pixels.clone();
    std::fs::remove_file(&path).unwrap();
    click(&mut rt, "undo");
    click(&mut rt, "redo");
    assert_eq!(rt.state.final_output().unwrap().frames[0].pixels, expected);
    image::RgbaImage::from_pixel(9, 7, image::Rgba([1, 2, 3, 255]))
        .save(&path)
        .unwrap();
    rt.state.request_io(worker::IoJob::Load(path));
    rt.frame(0.1);
    settle(&mut rt);
    assert_eq!(
        rt.state.source.as_ref().unwrap().frames[0]
            .pixels
            .dimensions(),
        (9, 7)
    );
    assert_eq!(rt.state.history.undo_label(), Some("Replace GIF"));
    assert!(rt.state.history.redo_label().is_none());
}

#[test]
fn edit_menu_routes_named_undo_duplicate_and_copy_actions() {
    let board = rune::clipboard::memory();
    let mut rt = runtime((980., 820.), false);
    rt.use_clipboard(&board);
    add(&mut rt, "Reverse");
    click(&mut rt, "edit");
    let menu_item = rt
        .elements()
        .into_iter()
        .find(|element| {
            element.role == "menuitem" && element.label.as_deref() == Some("Duplicate operation")
        })
        .unwrap();
    let [x, y, w, h] = menu_item.rect;
    rt.pointer_down(x + w / 2., y + h / 2.);
    rt.pointer_up(x + w / 2., y + h / 2.);
    rt.frame(0.05);
    settle(&mut rt);
    assert_eq!(rt.state.cards.len(), 2);
    assert!(!rt.state.edit_open);
    click(&mut rt, "undo");
    assert_eq!(rt.state.cards.len(), 1);
    rt.update(|s, tx| s.edit_action(editing::Action::CopyAll, tx));
    rt.frame(0.05);
    assert_eq!(
        clipboard::decode(board.content().unwrap().text()).unwrap(),
        [(Operation::Reverse, true)]
    );
}

#[test]
fn operation_clipboard_payload_is_not_inserted_as_json_into_a_focused_field() {
    let board = rune::clipboard::memory();
    let mut rt = runtime((980., 820.), false);
    rt.use_clipboard(&board);
    add(&mut rt, "Resize");
    double_click(&mut rt, "width-1");
    let payload = clipboard::encode(&[Card {
        id: 7,
        enabled: true,
        operation: Operation::Reverse,
    }])
    .unwrap();
    board.set_text(&payload);
    rt.update(|_, tx| tx.request_paste());
    rt.frame(0.1);
    settle(&mut rt);
    assert_eq!(rt.state.cards.len(), 2);
    assert_eq!(rt.state.cards[1].operation, Operation::Reverse);
    assert_eq!(rt.state.fields[&1][0].text, "320");
    click(&mut rt, "undo");
    assert_eq!(rt.state.cards.len(), 1);
}
