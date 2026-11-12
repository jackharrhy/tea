use super::*;
use img::fonts::FontChoice;
use rune::{GrowthSpec, Key, KeyEvent, ScrollSpec};
use rune_kit::{Popover, TextInput};
use std::rc::Rc;

enum Entry {
    Heading(&'static str),
    Font(FontChoice, usize),
}

fn choices(query: &str) -> Vec<FontChoice> {
    let fonts = img::fonts::choices().unwrap_or(img::fonts::builtins());
    let query = query.trim().to_lowercase();
    img::fonts::families(fonts)
        .into_iter()
        .filter(|font| {
            let name = font.family.to_lowercase();
            let mut letters = query.chars();
            let mut next = letters.next();
            for c in name.chars() {
                if next == Some(c) {
                    next = letters.next();
                }
            }
            next.is_none()
        })
        .cloned()
        .collect()
}
fn close(s: &mut State, id: u64) {
    if let Some(picker) = s.font_pickers.get_mut(&id) {
        picker.close();
    }
    s.font_visible.remove(&id);
}
fn choose(s: &mut State, id: u64, family: &str) {
    let fonts = img::fonts::choices().unwrap_or(img::fonts::builtins());
    let current = &s.fields[&id][8].text;
    let style = fonts
        .iter()
        .find(|font| &font.id == current)
        .map_or("Regular", |font| font.style.as_str());
    let selected = img::fonts::preferred_face(fonts, family, style).map(|font| font.id.clone());
    close(s, id);
    if let Some(selected) = selected {
        s.fields.get_mut(&id).expect("Text fields")[8] = TextEdit::new(selected);
        s.apply_parameters(id, &[8]);
    }
}
fn keyboard(s: &mut State, id: u64, event: &KeyEvent, tx: &mut Tx) -> bool {
    let picker = s.font_pickers.get_mut(&id).expect("Font picker");
    if picker.search.preedit.is_some() {
        return false;
    }
    if event.key == Key::Escape {
        if !tx.key_repeat() {
            close(s, id);
        }
        return true;
    }
    if event.mods.alt || event.mods.logo {
        return false;
    }
    let options = choices(&picker.search.text);
    let active = options
        .iter()
        .position(|font| Some(&font.family) == picker.active.as_ref())
        .unwrap_or(0);
    if event.key == Key::Enter {
        if !tx.key_repeat() {
            if let Some(font) = options.get(active) {
                choose(s, id, &font.family);
            } else {
                close(s, id);
            }
        }
        return true;
    }
    let unmodified = !event.mods.ctrl && !event.mods.cmd && !event.mods.shift;
    let next = match &event.key {
        Key::Down if unmodified => (active + 1) % options.len().max(1),
        Key::Up if unmodified => (active + options.len().max(1) - 1) % options.len().max(1),
        Key::Text(c) if event.mods.ctrl && !event.mods.shift && c == "n" => {
            (active + 1) % options.len().max(1)
        }
        Key::Text(c) if event.mods.ctrl && !event.mods.shift && c == "p" => {
            (active + options.len().max(1) - 1) % options.len().max(1)
        }
        Key::Command('n') if event.mods.ctrl && !event.mods.shift => {
            (active + 1) % options.len().max(1)
        }
        Key::Command('p') if event.mods.ctrl && !event.mods.shift => {
            (active + options.len().max(1) - 1) % options.len().max(1)
        }
        Key::PageDown if unmodified => (active + 10).min(options.len().saturating_sub(1)),
        Key::PageUp if unmodified => active.saturating_sub(10),
        Key::Home if unmodified && picker.search.text.is_empty() => 0,
        Key::End if unmodified && picker.search.text.is_empty() => options.len().saturating_sub(1),
        _ => return false,
    };
    if let Some(font) = options.get(next) {
        picker.active = Some(font.family.clone());
        tx.scroll_into_view(format!("font-menu-{id}-option-{}", font.family));
    }
    true
}
fn option(s: &State, id: u64, font: &FontChoice, index: usize, count: usize, selected: &str) -> El {
    let picker = &s.font_pickers[&id];
    let family = font.family.clone();
    let hover = family.clone();
    let active = picker
        .active
        .as_ref()
        .is_some_and(|active| active == &font.family);
    let live = s
        .font_visible
        .get(&id)
        .is_some_and(|visible| visible.contains(&font.family));
    let name = label(&font.family)
        .key(format!(
            "font-{}-{}",
            if live { "live" } else { "pending" },
            font.id
        ))
        .font(if live {
            super::super::font_preview::style(&font.family, 16.)
        } else {
            rune::tok::type_::LABEL.lh(22.)
        })
        .truncate()
        .a11y_hidden();
    row()
        .help(&font.family)
        .role("option")
        .label(&font.family)
        .position_in_set(index + 1, count)
        .focus_selected(active)
        .w_full()
        .h(32.)
        .px(10.)
        .gap(8.)
        .center_y()
        .radius(2.)
        .fill(if active {
            rune::oklch(0.94, 0., 0.)
        } else {
            Color::TRANSPARENT
        })
        .child(
            el().grow(1.)
                .min_w(0.)
                .h(22.)
                .clip_soft(0.)
                .center_y()
                .child(name),
        )
        .child(
            icon(kit().glyph.check_small, 14.)
                .color(ink())
                .opacity(if selected == font.family { 1. } else { 0. }),
        )
        .on_hover(move |s: &mut State| {
            s.font_pickers.get_mut(&id).expect("Font picker").active = Some(hover.clone());
        })
        .on_press_tx(move |s: &mut State, _| choose(s, id, &family))
}

pub(super) fn build(
    s: &State,
    id: u64,
    family: &str,
    width: f32,
    trigger: El,
    overlays: &mut Vec<El>,
) -> El {
    let picker = &s.font_pickers[&id];
    let current = family.to_owned();
    let trigger = trigger.on_press_tx(move |s: &mut State, tx| {
        let picker = s.font_pickers.get_mut(&id).expect("Font picker");
        if picker.open {
            close(s, id);
            return;
        }
        picker.open = true;
        picker.search.clear();
        picker.search.focused = true;
        picker.active = Some(current.clone());
        tx.scroll_into_view(format!("font-menu-{id}-option-{current}"));
    });
    let mut popup = Popover::new(format!("font-menu-{id}"))
        .label("Font")
        .trigger(trigger)
        .padding(0.)
        .placement(rune_kit::Placement::BottomStart)
        .open(picker.open)
        .on_close(move |s: &mut State| close(s, id));
    if picker.open {
        let fonts = Rc::new(choices(&picker.search.text));
        let count = fonts.len();
        let grouped = picker.search.text.is_empty();
        let mut entries = vec![];
        let mut group = None;
        for (index, font) in fonts.iter().enumerate() {
            let title = if img::fonts::common_family(&font.family) {
                "Common fonts"
            } else {
                "All fonts"
            };
            if grouped && group != Some(title) {
                entries.push(Entry::Heading(title));
                group = Some(title);
            }
            entries.push(Entry::Font(font.clone(), index));
        }
        let entries = Rc::new(entries);
        let keys = entries.clone();
        let rows = entries.clone();
        let visible = entries.clone();
        let selected = family.to_owned();
        let list = col()
            .key("rows")
            .w_full()
            .growth(GrowthSpec::default())
            .virtual_rows(
                entries.len(),
                32.,
                move |_: &State, index| match &keys[index] {
                    Entry::Font(font, _) => format!("font-menu-{id}-option-{}", font.family).into(),
                    Entry::Heading(title) => format!("font-group-{id}-{title}").into(),
                },
                move |s: &State, index| match &rows[index] {
                    Entry::Font(font, position) => option(s, id, font, *position, count, &selected),
                    Entry::Heading(title) => row()
                        .h(26.)
                        .px(10.)
                        .center_y()
                        .child(label(*title).color(muted())),
                },
            )
            .reveal_selected(true)
            .on_visible_rows(move |s: &mut State, range| {
                let now: std::collections::HashSet<_> = visible[range]
                    .iter()
                    .filter_map(|entry| match entry {
                        Entry::Font(font, _) => Some(font.family.clone()),
                        Entry::Heading(_) => None,
                    })
                    .collect();
                if s.font_visible.get(&id) == Some(&now) {
                    false
                } else {
                    s.font_visible.insert(id, now);
                    true
                }
            });
        let viewport = col()
            .key("viewport")
            .role("listbox")
            .label("Font")
            .w_full()
            .h((entries.len() as f32 * 32.).min(288.))
            .shrink()
            .min_h(if count == 0 { 0. } else { 32. })
            .scroll(ScrollSpec {
                stick_bottom: false,
            })
            .scroll_edge_fade(12.)
            .scroll_margin(12.)
            .clip_soft(0.)
            .child(list);
        let active = picker
            .active
            .as_deref()
            .filter(|active| fonts.iter().any(|font| font.family == *active));
        let mut search = TextInput::new(&picker.search)
            .plain()
            .height(36.)
            .width(None)
            .leading_icon(kit().glyph.search)
            .placeholder("Search fonts…")
            .label("Search Font");
        if let Some(active) = active {
            search = search.active_descendant(Some(format!("font-menu-{id}-option-{active}")));
        }
        let search = search
            .on_edit(move |s: &mut State| {
                &mut s.font_pickers.get_mut(&id).expect("Font picker").search
            })
            .on_change(move |s: &mut State, tx| {
                s.font_visible.remove(&id);
                let picker = s.font_pickers.get_mut(&id).expect("Font picker");
                picker.active = choices(&picker.search.text)
                    .first()
                    .map(|font| font.family.clone());
                if let Some(active) = &picker.active {
                    tx.scroll_into_view(format!("font-menu-{id}-option-{active}"));
                }
            })
            .on_key(move |s: &mut State, event, tx| keyboard(s, id, event, tx))
            .build(&kit())
            .key("search");
        let results = col()
            .key("results")
            .w_full()
            .padding(4.)
            .min_h(0.)
            .shrink()
            .preserve_focus_on_press(true)
            .child(
                rune_kit::scroll_bar(
                    &kit(),
                    &format!("font-menu-{id}-scroll-area"),
                    "viewport",
                    viewport,
                )
                .w_full()
                .shrink()
                .min_h(0.),
            );
        let mut body = col()
            .w(width.min(320.))
            .shrink()
            .min_h(0.)
            .child(row().key("header").w_full().px(4.).child(search))
            .child(el().w_full().h(1.).fill(line()).a11y_hidden())
            .child(results);
        if let Some(active) = active
            .or_else(|| {
                fonts
                    .iter()
                    .find(|font| font.family == family)
                    .map(|font| font.family.as_str())
            })
            .or_else(|| fonts.first().map(|font| font.family.as_str()))
        {
            let live = s
                .font_visible
                .get(&id)
                .is_some_and(|visible| visible.contains(active));
            let caption = &s.fields[&id][0].text;
            let caption = if caption.trim().is_empty() {
                "Aa Bb Cc"
            } else {
                caption.as_str()
            };
            let compact = s.list.viewport[3] > 0. && s.list.viewport[3] < 480.;
            let mut specimen = col()
                .key("font-specimen")
                .h(if compact { 44. } else { 66. })
                .px(12.)
                .py(7.)
                .gap(2.)
                .clip_soft(0.);
            if !compact {
                specimen = specimen.child(label(active).key("font-specimen-family").color(muted()));
            }
            specimen = specimen.child(
                text(caption)
                    .key("font-specimen-text")
                    .font(if live {
                        super::super::font_preview::style(active, 20.)
                    } else {
                        rune::TextStyle::new(20., 400.).lh(26.)
                    })
                    .color(ink())
                    .truncate(),
            );
            body = body
                .child(el().h(1.).w_full().fill(line()).a11y_hidden())
                .child(specimen);
        }
        popup = popup.child(if count == 0 {
            body.child(label("No fonts found").h(28.).px(12.))
        } else {
            body
        });
    }
    popup.build(&kit(), overlays)
}
