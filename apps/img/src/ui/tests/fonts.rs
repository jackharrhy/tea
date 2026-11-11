use super::*;

#[test]
fn font_menu_search_and_typography_controls_apply_and_preserve_values() {
    img::fonts::load_system_fonts();
    let mut rt = runtime((980., 820.), false);
    add(&mut rt, "Text caption");
    click(&mut rt, "font-trigger-1");
    assert!(rt.state.font_pickers[&1].open);
    let before = rt.state.cards[0].operation.clone();
    rt.key(KeyEvent {
        key: Key::Down,
        mods: Default::default(),
    });
    rt.frame(0.1);
    assert_eq!(rt.state.cards[0].operation, before);
    rt.key(KeyEvent {
        key: Key::Text("no-such-font-img-xyz".into()),
        mods: Default::default(),
    });
    rt.frame(0.1);
    assert!(!rt.elements().iter().any(|e| e.role == "option"));
    rt.key(KeyEvent {
        key: Key::Escape,
        mods: Default::default(),
    });
    rt.frame(0.1);
    assert!(!rt.state.font_pickers[&1].open);
    click(&mut rt, "font-trigger-1");
    let choice = img::fonts::choices()
        .unwrap()
        .iter()
        .find(|f| !f.id.is_empty());
    if let Some(choice) = choice {
        rt.key(KeyEvent {
            key: Key::Text(choice.family.clone()),
            mods: Default::default(),
        });
        rt.frame(0.1);
        let key = format!("font-menu-1-option-{}", choice.family);
        click(&mut rt, &key);
        assert!(
            matches!(&rt.state.cards[0].operation, Operation::Text { font, .. } if font == &choice.id)
        );
    } else {
        rt.key(KeyEvent {
            key: Key::Escape,
            mods: Default::default(),
        });
        rt.frame(0.1);
    }
    click(&mut rt, "typography-1");
    enter(&mut rt, "tracking-1", "2.5");
    enter(&mut rt, "leading-1", "140");
    click(&mut rt, "line-align-1-1");
    assert!(
        matches!(&rt.state.cards[0].operation, Operation::Text { tracking, leading, align: 1, .. } if *tracking == 2.5 && *leading == 140.)
    );
    click(&mut rt, "typography-1");
    click(&mut rt, "typography-1");
    assert_eq!(rt.state.fields[&1][9].text, "2.5");
}

#[test]
fn font_picker_lists_each_family_once_and_styles_change_the_actual_face() {
    img::fonts::load_system_fonts();
    let choices = img::fonts::choices().unwrap();
    let mut rt = runtime((980., 820.), false);
    add(&mut rt, "Text caption");
    click(&mut rt, "font-trigger-1");
    let names: Vec<_> = rt
        .elements()
        .iter()
        .filter(|e| e.role == "option")
        .filter_map(|e| e.label.clone())
        .collect();
    assert_eq!(
        names.iter().filter(|name| name.as_str() == "Inter").count(),
        1
    );
    assert!(names.contains(&"Anton".into()));
    assert!(!names.iter().any(|name| name.contains("bundled")));
    let bold = choices.iter().find(|font| {
        font.style == "Bold"
            && choices
                .iter()
                .any(|other| other.family == font.family && other.style == "Regular")
    });
    if let Some(bold) = bold {
        rt.key(KeyEvent {
            key: Key::Text(bold.family.clone()),
            mods: Default::default(),
        });
        rt.frame(0.1);
        click(&mut rt, &format!("font-menu-1-option-{}", bold.family));
        click(&mut rt, "font-style-trigger-1");
        rt.key(KeyEvent {
            key: Key::Text("Bold".into()),
            mods: Default::default(),
        });
        rt.frame(0.1);
        click(&mut rt, &format!("font-style-menu-1-option-{}", bold.id));
        assert!(
            matches!(&rt.state.cards[0].operation, Operation::Text { font, .. } if font == &bold.id)
        );
    }
}

#[test]
fn native_font_menu_shapes_only_visible_rows_and_previews_without_committing() {
    img::fonts::load_system_fonts();
    let mut rt = runtime((980., 820.), false);
    add(&mut rt, "Text caption");
    click(&mut rt, "font-trigger-1");
    for _ in 0..6 {
        rt.frame(1. / 60.);
    }
    let visible = rt.state.font_visible[&1].clone();
    assert!(
        !visible.is_empty() && visible.len() <= 10,
        "Only visible fonts request native shaping: {visible:?}"
    );
    let choices = img::fonts::choices().unwrap();
    for font in img::fonts::families(choices) {
        assert_eq!(
            rt.find(&format!("font-live-{}", font.id)).is_some(),
            visible.contains(&font.family),
            "{} visibility",
            font.family
        );
    }
    assert!(rt.find("font-specimen").is_some());
    let before = rt.state.cards[0].operation.clone();
    let (x, y) = rt.find("font-menu-1-option-Anton").unwrap();
    rt.pointer_move(x, y);
    rt.frame(0.1);
    assert_eq!(rt.state.cards[0].operation, before);
    let specimen = rt
        .elements()
        .into_iter()
        .find(|el| {
            el.key
                .as_deref()
                .is_some_and(|key| key.ends_with("font-specimen-family"))
        })
        .unwrap();
    assert_eq!(specimen.text.as_deref(), Some("Anton"));
    let viewport = rt
        .elements()
        .into_iter()
        .find(|el| el.role == "listbox" && el.label.as_deref() == Some("Font"))
        .unwrap()
        .visible;
    if img::fonts::families(choices).len() > 24 {
        rt.wheel(viewport[0] + 30., viewport[1] + 30., -400.);
        for _ in 0..6 {
            rt.frame(1. / 60.);
        }
        assert_ne!(rt.state.font_visible[&1], visible);
        assert!(rt.state.font_visible[&1].len() <= 10);
    }
    rt.key(KeyEvent {
        key: Key::Escape,
        mods: Default::default(),
    });
    rt.frame(0.1);
    assert!(!rt.state.font_pickers[&1].open);
    assert!(!rt.state.font_visible.contains_key(&1));
    assert_eq!(rt.state.cards[0].operation, before);
}
