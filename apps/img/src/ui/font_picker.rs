use super::*;
use rune_kit::{Combobox, ComboboxOption};

fn trigger(id: u64, style: bool, value: &str, width: f32) -> El {
    row()
        .key(format!(
            "font-{}trigger-{id}",
            if style { "style-" } else { "" }
        ))
        .role("button")
        .label(if style {
            "Choose font style"
        } else {
            "Choose font"
        })
        .focusable(true)
        .w(width)
        .h(26.)
        .px(6.)
        .gap(6.)
        .center_y()
        .radius(2.)
        .border(0.75, line())
        .fill(Color::WHITE)
        .child(label(value).truncate().grow(1.).min_w(0.))
        .child(
            icon(&CHEVRON, 12.)
                .rotate(std::f32::consts::FRAC_PI_2)
                .color(muted()),
        )
}

pub(super) fn control(
    s: &State,
    id: u64,
    width: f32,
    fields: &[TextEdit],
    overlays: &mut Vec<El>,
) -> El {
    let choices = img::fonts::choices().unwrap_or(img::fonts::builtins());
    let current = choices.iter().find(|font| font.id == fields[8].text);
    let family = current.map_or(fields[8].text.as_str(), |font| font.family.as_str());
    let family_width = width - 124.;
    let family_picker = super::font_menu::build(
        s,
        id,
        family,
        width,
        trigger(id, false, family, family_width),
        overlays,
    );
    let mut seen = std::collections::HashSet::new();
    let style_options: Vec<_> = choices
        .iter()
        .filter(|font| font.family == family && seen.insert(font.style.clone()))
        .map(|font| ComboboxOption {
            id: font.id.clone(),
            label: font.style.clone(),
            detail: String::new(),
            disabled: false,
        })
        .collect();
    let style_picker = Combobox::new(
        format!("font-style-menu-{id}"),
        s.font_styles.get(&id).expect("Text style picker"),
        &style_options,
        move |s: &mut State| s.font_styles.get_mut(&id).expect("Text style picker"),
    )
    .label("Font style")
    .placement(rune_kit::Placement::BottomStart)
    .current(Some(&fields[8].text))
    .search_placeholder("Search styles…")
    .width(240.)
    .max_height(240.)
    .trigger(trigger(
        id,
        true,
        current.map_or("Regular", |font| font.style.as_str()),
        116.,
    ))
    .on_choose(move |s: &mut State, font, _| {
        s.fields.get_mut(&id).expect("Text fields")[8] = TextEdit::new(font);
        s.apply_parameters(id, &[8]);
    })
    .build(&kit(), overlays);
    row()
        .gap(8.)
        .child(col().gap(4.).child(label("Font")).child(family_picker))
        .child(col().gap(4.).child(label("Style")).child(style_picker))
}
