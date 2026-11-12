use super::*;

type Scene = (&'static str, fn(&mut State));
pub(super) const ALL: &[Scene] = &[
    ("loaded", loaded_scene),
    ("edited", edited_scene),
    ("caption", caption_scene),
    ("typography", typography_scene),
    ("fonts", fonts_scene),
    ("picker", picker_scene),
    ("color", color_scene),
    ("editing", editing_scene),
    ("numbers", numbers_scene),
    ("rotate", rotate_scene),
    ("crop", crop_scene),
    ("resize", resize_scene),
];

fn loaded_scene(s: &mut State) {
    let path = PathBuf::from(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/samples/hummingbird.gif"
    ));
    s.source = Some(Arc::new(Animation::load(&path).expect("bundled sample")));
    s.name = "hummingbird.gif".into();
    s.playing = false;
    s.refresh();
}
fn edited_scene(s: &mut State) {
    loaded_scene(s);
    s.cards = vec![
        Card {
            id: 1,
            enabled: true,
            operation: Operation::Resize {
                width: 320,
                height: 180,
            },
        },
        Card {
            id: 2,
            enabled: true,
            operation: Operation::Reverse,
        },
    ];
    s.next_id = 3;
    s.fields
        .insert(1, vec![TextEdit::new("320"), TextEdit::new("180")]);
    s.outputs = img::RenderCache::default()
        .render(
            s.source.clone().expect("Loaded scene"),
            &s.cards,
            None,
            None,
        )
        .expect("Scene operations");
    s.frames_open = true;
    s.refresh();
}
pub(super) fn caption_scene(s: &mut State) {
    loaded_scene(s);
    let operations = vec![
        Operation::Resize {
            width: 320,
            height: 180,
        },
        Operation::Text {
            text: "hello, bird.".into(),
            x: 12,
            y: 145,
            size: 22,
            red: 255,
            green: 255,
            blue: 255,
            outline: 1,
            font: String::new(),
            tracking: 0.,
            leading: 100.,
            align: 0,
        },
    ];
    s.cards = operations
        .into_iter()
        .enumerate()
        .map(|(i, operation)| {
            let id = i as u64 + 1;
            if matches!(operation, Operation::Text { .. }) {
                s.font_pickers.insert(id, Default::default());
                s.font_styles.insert(id, Default::default());
            }
            s.fields.insert(
                id,
                operation
                    .parameters()
                    .iter()
                    .map(|p| TextEdit::new(&p.value))
                    .collect(),
            );
            Card {
                id,
                enabled: true,
                operation,
            }
        })
        .collect();
    s.next_id = s.cards.len() as u64 + 1;
    s.outputs = img::RenderCache::default()
        .render(
            s.source.clone().expect("Loaded scene"),
            &s.cards,
            None,
            None,
        )
        .expect("Caption scene");
    s.collapsed.extend([0, 1]);
    s.details.insert((2, "position"));
    s.frames_open = true;
    s.refresh();
}
fn typography_scene(s: &mut State) {
    caption_scene(s);
    s.details.remove(&(2, "position"));
    s.details.insert((2, "typography"));
}
fn fonts_scene(s: &mut State) {
    img::fonts::load_system_fonts();
    caption_scene(s);
    let picker = s.font_pickers.get_mut(&2).expect("Caption font picker");
    picker.open = true;
    picker.active = Some("Inter".into());
    picker.search.focused = true;
}
fn editing_scene(s: &mut State) {
    caption_scene(s);
    let mut operation = s.cards[1].operation.clone();
    if let Operation::Text { font, .. } = &mut operation {
        *font = "Anton-Regular".into();
    }
    s.edit_operation(2, operation, "Change font", None);
    s.duplicate();
    s.undo();
    s.edit_open = true;
}
fn color_scene(s: &mut State) {
    caption_scene(s);
    s.open_color(2, 4);
}
fn numbers_scene(s: &mut State) {
    loaded_scene(s);
    s.cards = [
        Operation::Opacity { percent: 72. },
        Operation::Brightness { amount: 20 },
        Operation::Gamma { gamma: 1.2 },
    ]
    .into_iter()
    .enumerate()
    .map(|(index, operation)| Card {
        id: index as u64 + 1,
        enabled: true,
        operation,
    })
    .collect();
    s.next_id = 4;
    s.rebuild_fields();
    s.collapsed.insert(0);
    s.outputs = img::RenderCache::default()
        .render(
            s.source.clone().expect("Loaded scene"),
            &s.cards,
            None,
            None,
        )
        .expect("Number field scene");
    s.refresh();
}
fn picker_scene(s: &mut State) {
    loaded_scene(s);
    s.picker.open = true;
}
fn spatial_scene(s: &mut State, operation: Operation) {
    loaded_scene(s);
    s.cards = vec![Card {
        id: 1,
        enabled: true,
        operation,
    }];
    s.next_id = 2;
    s.rebuild_fields();
    s.collapsed.insert(0);
    s.outputs = img::RenderCache::default()
        .render(
            s.source.clone().expect("Loaded scene"),
            &s.cards,
            None,
            None,
        )
        .expect("Spatial scene");
    s.refresh();
}
fn rotate_scene(s: &mut State) {
    spatial_scene(s, Operation::Rotate { degrees: 15. });
}
fn crop_scene(s: &mut State) {
    spatial_scene(
        s,
        Operation::Crop {
            x: 50,
            y: 30,
            width: 320,
            height: 180,
        },
    );
}
fn resize_scene(s: &mut State) {
    spatial_scene(
        s,
        Operation::Resize {
            width: 320,
            height: 180,
        },
    );
}
