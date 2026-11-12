use super::*;
use img::{Parameter, ParameterKind};
use rune_kit::{Combobox, ComboboxOption};

fn groups(parameters: &[Parameter]) -> Vec<std::ops::Range<usize>> {
    let rgb = |index: usize| {
        parameters
            .get(index..index + 3)
            .is_some_and(|p| p.iter().map(|v| v.key).eq(["red", "green", "blue"]))
    };
    let mut groups = vec![];
    let mut index = 0;
    while index < parameters.len() {
        let count = if parameters[index].kind != ParameterKind::Number {
            1
        } else if rgb(index) {
            3
        } else if parameters
            .get(index + 1)
            .is_some_and(|p| p.kind == ParameterKind::Number)
            && !rgb(index + 1)
        {
            2
        } else {
            1
        };
        groups.push(index..index + count);
        index += count;
    }
    groups
}
fn field(
    state: &State,
    id: u64,
    index: usize,
    param: &Parameter,
    edit: &TextEdit,
    width: f32,
) -> El {
    let kind = param.kind;
    let mut input = text_input(edit, rune::tok::type_::LABEL)
        .key(format!("{}-{id}", param.key))
        .label(param.label)
        .on_edit(move |s: &mut State| {
            // Rune can blur an exiting input after undo removed its card.
            let fields = s.fields.entry(id).or_default();
            if fields.len() <= index {
                fields.resize_with(index + 1, TextEdit::default);
            }
            &mut fields[index]
        })
        .on_input_change(move |s: &mut State, _| s.queue_field(id, index))
        .on_input_paste(move |s: &mut State, content, tx| {
            if kind == ParameterKind::File
                && let Some(path) = content.files().first()
                && content.files().len() == 1
            {
                if let Some(field) = s
                    .fields
                    .get_mut(&id)
                    .and_then(|fields| fields.get_mut(index))
                {
                    field.insert(&path.to_string_lossy());
                    s.queue_field(id, index);
                }
                return true;
            }
            if super::super::clipboard::operation_transfer(content.text())
                || content.image().is_some()
                || !content.files().is_empty()
            {
                s.active = Some(id);
                s.paste_content(content);
                tx.blur();
                return true;
            }
            false
        })
        .on_input_key(move |s: &mut State, event, tx| {
            if event.key == Key::Escape {
                s.pending_fields.remove(&(id, index));
                if let Some(parameter) = s
                    .cards
                    .iter()
                    .find(|card| card.id == id)
                    .and_then(|card| card.operation.parameters().into_iter().nth(index))
                    && let Some(field) = s
                        .fields
                        .get_mut(&id)
                        .and_then(|fields| fields.get_mut(index))
                {
                    *field = TextEdit::new(parameter.value);
                    s.local_edits.remove(&(id, index));
                }
                tx.blur();
                return true;
            }
            if kind == ParameterKind::Number
                && matches!(event.key, Key::Up | Key::Down)
                && !event.mods.cmd
                && !event.mods.ctrl
                && !event.mods.alt
            {
                let delta = if event.key == Key::Up { 1 } else { -1 };
                s.step_number(id, index, delta, event.mods.shift);
                return true;
            }
            s.parameter_key(id, index, event, tx)
        })
        .on_submit(move |s: &mut State, tx| {
            s.apply_parameters(id, &[index]);
            if kind == ParameterKind::Number && !s.local_edits.contains(&(id, index)) {
                if let Some(field) = s
                    .fields
                    .get_mut(&id)
                    .and_then(|fields| fields.get_mut(index))
                {
                    field.focused = false;
                }
                tx.blur();
            }
        });
    if param.kind != ParameterKind::Text {
        input = input.single_line();
    }
    input = input.help(if param.kind == ParameterKind::Text {
        "Shift+Enter for a new line".into()
    } else if param.kind == ParameterKind::File {
        "Choose an image or paste a local path".into()
    } else {
        format!("{} to {}", param.min, param.max)
    });
    let file = param.kind == ParameterKind::File;
    let input_width = if file { width - 30. } else { width };
    let box_ = if kind == ParameterKind::Number {
        super::number::control(state, id, index, param, edit, input, input_width)
    } else {
        input_box(input, input_width, param.kind == ParameterKind::Text)
    };
    let control = if file {
        row().gap(8.).center_y().child(box_).child(icon_button(
            format!("file-{id}"),
            "Choose image…",
            &FOLDER,
            move |s, tx| s.choose_file(id, index, tx),
        ))
    } else {
        box_
    };
    col()
        .w(width)
        .gap(4.)
        .child(label(param.label).truncate().help(param.label))
        .child(control)
}

pub(super) fn picker(s: &State, kit: &Kit, overlays: &mut Vec<El>) -> El {
    let options: Vec<_> = Operation::catalog()
        .into_iter()
        .map(|op| ComboboxOption {
            id: op.id().into(),
            label: op.name().into(),
            detail: op.category().into(),
            disabled: false,
        })
        .collect();
    let unavailable =
        (s.worker.is_io()) || s.source.is_none() || s.cards.len() >= img::MAX_OPERATIONS;
    Combobox::new("operation-menu", &s.picker, &options, |s: &mut State| {
        &mut s.picker
    })
    .label("operation")
    .placement(rune_kit::Placement::BottomStart)
    .search_placeholder("Find an operation…")
    .width(318.)
    .max_height(360.)
    .trigger(button("add", "Add operation", |_, _| {}).blocked(unavailable))
    .disabled(unavailable)
    .on_choose(|s: &mut State, kind, _| s.add_named(kind))
    .build(kit, overlays)
}

fn section(s: &State, id: u64, key: &'static str, title: &'static str) -> El {
    let open = s.details.contains(&(id, key));
    row()
        .key(format!("{key}-{id}"))
        .gap(3.)
        .center_y()
        .h(24.)
        .role("button")
        .label(title)
        .focusable(true)
        .expanded(open)
        .on_press_tx(move |s: &mut State, tx| {
            s.toggle_detail(id, key);
            tx.animated();
        })
        .child(
            icon(&CHEVRON, 12.)
                .rotate(if open {
                    std::f32::consts::FRAC_PI_2
                } else {
                    0.
                })
                .color(muted()),
        )
        .child(label(title).color(muted()))
}
fn text_controls(
    s: &State,
    id: u64,
    width: f32,
    fields: &[TextEdit],
    parameters: &[Parameter],
    overlays: &mut Vec<El>,
) -> El {
    let mut controls = col()
        .gap(6.)
        .child(field(s, id, 0, &parameters[0], &fields[0], width - 16.))
        .child(super::font_picker::control(
            s,
            id,
            width - 16.,
            fields,
            overlays,
        ))
        .child(
            row()
                .gap(8.)
                .center_y()
                .child(field(s, id, 3, &parameters[3], &fields[3], 96.))
                .child(super::color::control(s, id, 4, overlays)),
        )
        .child(section(s, id, "position", "Position"));
    if s.details.contains(&(id, "position")) {
        controls = controls
            .child(
                row()
                    .gap(8.)
                    .child(field(s, id, 1, &parameters[1], &fields[1], 116.))
                    .child(field(s, id, 2, &parameters[2], &fields[2], 116.)),
            )
            .child(super::placement::alignment(s, id));
    }
    controls = controls.child(section(s, id, "typography", "Typography"));
    if s.details.contains(&(id, "typography")) {
        let mut alignment = row().gap(4.);
        for (value, title) in ["Left", "Center", "Right"].iter().enumerate() {
            alignment = alignment.child(
                button(format!("line-align-{id}-{value}"), *title, move |s, _| {
                    s.fields.get_mut(&id).expect("Text fields")[11] =
                        TextEdit::new(value.to_string());
                    s.apply_parameters(id, &[11]);
                })
                .checked(fields[11].text == value.to_string())
                .fill(if fields[11].text == value.to_string() {
                    rune::oklch(0.93, 0., 0.)
                } else {
                    Color::WHITE
                }),
            );
        }
        controls = controls
            .child(
                col()
                    .gap(4.)
                    .child(label("Line alignment"))
                    .child(alignment),
            )
            .child(
                row()
                    .gap(8.)
                    .child(field(s, id, 9, &parameters[9], &fields[9], 136.))
                    .child(field(s, id, 10, &parameters[10], &fields[10], 136.)),
            );
    }
    controls = controls.child(section(s, id, "appearance", "Appearance"));
    if s.details.contains(&(id, "appearance")) {
        controls = controls.child(field(s, id, 7, &parameters[7], &fields[7], 116.));
    }
    controls
}

fn overlay_controls(
    s: &State,
    id: u64,
    width: f32,
    fields: &[TextEdit],
    parameters: &[Parameter],
) -> El {
    let mut controls = col()
        .gap(6.)
        .child(field(s, id, 0, &parameters[0], &fields[0], width - 16.))
        .child(
            row()
                .gap(8.)
                .center_y()
                .child(field(s, id, 3, &parameters[3], &fields[3], 136.))
                .child(field(s, id, 4, &parameters[4], &fields[4], 116.)),
        )
        .child(section(s, id, "position", "Position"));
    if s.details.contains(&(id, "position")) {
        controls = controls.child(
            row()
                .gap(8.)
                .child(field(s, id, 1, &parameters[1], &fields[1], 116.))
                .child(field(s, id, 2, &parameters[2], &fields[2], 116.)),
        );
    }
    controls
}

pub(super) fn card(
    s: &State,
    index: usize,
    heights: &[f32],
    width: f32,
    origin: [f32; 2],
    selected: u64,
    overlays: &mut Vec<El>,
) -> El {
    let card = &s.cards[index];
    let id = card.id;
    let count = s.cards.len();
    let busy = s.worker.is_io();
    let expanded = !s.collapsed.contains(&id);
    let has_fields = !card.operation.parameters().is_empty();
    let geometry = heights.to_vec();
    let handle = el()
        .key(format!("drag-{id}"))
        .size(16., 24.)
        .center()
        .cursor(if s.dragging.as_ref().is_some_and(|d| d.id == id) {
            rune::Cursor::Grabbing
        } else {
            rune::Cursor::Grab
        })
        .role("button")
        .label("Drag to reorder")
        .help("Drag to reorder. Escape cancels.")
        .on_drag(move |s: &mut State, drag, tx| s.drag(id, drag, &geometry, width, origin, tx))
        .child(icon(&GRIP, 16.).color(muted()));
    let header = row()
        .gap(3.)
        .center_y()
        .child(handle)
        .child(
            icon_button(format!("up-{id}"), "Move step up", &UP, move |s, _| {
                s.move_card(index, index - 1)
            })
            .blocked(index == 0),
        )
        .child(
            icon_button(
                format!("down-{id}"),
                "Move step down",
                &DOWN,
                move |s, _| s.move_card(index, index + 1),
            )
            .blocked(index + 1 == count),
        )
        .child(
            icon_button(
                format!("eye-{id}"),
                if card.enabled {
                    "Bypass step"
                } else {
                    "Apply step"
                },
                if card.enabled { &EYE } else { &CLOSED_EYE },
                move |s, _| s.toggle(id),
            )
            .checked(card.enabled),
        )
        .child(
            row()
                .key(format!("collapse-{id}"))
                .gap(2.)
                .center_y()
                .min_w(0.)
                .grow(1.)
                .h(24.)
                .role("button")
                .label(format!(
                    "{} {}",
                    if expanded { "Collapse" } else { "Expand" },
                    card.operation.name()
                ))
                .expanded(expanded)
                .focusable(true)
                .help(card.operation.description())
                .on_press_tx(move |s: &mut State, tx| {
                    s.toggle_collapsed(id);
                    tx.animated();
                })
                .child(
                    icon(&CHEVRON, 12.)
                        .rotate(if expanded {
                            std::f32::consts::FRAC_PI_2
                        } else {
                            0.
                        })
                        .color(muted())
                        .opacity(if has_fields { 1. } else { 0. }),
                )
                .child(
                    pill(card.operation.name())
                        .min_w(0.)
                        .max_w((width - 196.).max(64.)),
                ),
        )
        .child(preview_button(id, selected == id, s.ready()))
        .child(icon_button(
            format!("delete-{id}"),
            "Delete step",
            &DELETE,
            move |s, _| s.remove(id),
        ));
    let mut body = frame(s.active == Some(id) || (s.active.is_none() && selected == id))
        .key(format!("step-{id}"))
        .focusable(true)
        .on_press_tx(move |s: &mut State, tx| {
            s.active = Some(id);
            tx.blur();
        })
        .on_secondary_press(move |s: &mut State, press, _| s.operation_context(id, press))
        .child(header.blocked(busy));
    if expanded && let Some(fields) = s.fields.get(&id) {
        let parameters = card.operation.parameters();
        if matches!(card.operation, Operation::Text { .. }) {
            body = body.child(text_controls(s, id, width, fields, &parameters, overlays));
        } else if matches!(card.operation, Operation::Overlay { .. }) {
            body = body.child(overlay_controls(s, id, width, fields, &parameters));
        } else {
            for group in groups(&parameters) {
                let count = group.len();
                let first = group.start;
                let mut controls = row().gap(8.).center_y();
                let color = count == 3
                    && parameters[group.clone()]
                        .iter()
                        .all(|p| p.min == 0. && p.max == 255.);
                if color {
                    controls = controls.child(super::color::control(s, id, first, overlays));
                }
                for index in group.filter(|_| !color) {
                    let width = if parameters[index].kind == ParameterKind::Number {
                        if count == 3 { 76. } else { 116. }
                    } else {
                        (width - 16.).max(240.)
                    };
                    controls = controls.child(field(
                        s,
                        id,
                        index,
                        &parameters[index],
                        &fields[index],
                        width,
                    ));
                }

                body = body.child(controls);
            }
        }
    }
    body = body.opacity(if card.enabled { 1. } else { 0.45 });
    let mut slot = el()
        .key(format!("slot-{id}"))
        .w_full()
        .motion(rune::Spring::new(0.18, 0.));
    if let Some(drag) = &s.dragging {
        if drag.id == id {
            let held = body
                .clone()
                .key(format!("held-{id}"))
                .w(width)
                .absolute(drag.held_origin[0], drag.held_origin[1])
                .raise()
                .live_offset(&drag.offset)
                .shadow(4., 12., Color::BLACK.alpha(0.12))
                .inert()
                .a11y_hidden();
            overlays.push(held);
            slot = slot.child(body.opacity(0.2));
        } else {
            slot = slot.child(body);
        }
        if drag.from != drag.to && index == drag.to {
            slot = slot.child(
                el().key("drop-marker")
                    .absolute(
                        -6.,
                        if drag.from < drag.to {
                            heights[index] + 3.
                        } else {
                            -5.
                        },
                    )
                    .w(width + 12.)
                    .h(2.)
                    .fill(ink())
                    .child(el().absolute(0., -1.).size(4., 4.).radius(2.).fill(ink()))
                    .child(
                        el().absolute(width + 8., -1.)
                            .size(4., 4.)
                            .radius(2.)
                            .fill(ink()),
                    )
                    .inert(),
            );
        }
    } else {
        slot = slot.child(body);
    }
    slot
}
