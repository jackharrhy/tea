use super::*;
use img::Parameter;
use rune::{Drag, Phase};

pub(crate) struct Gesture {
    id: u64,
    index: usize,
    before: crate::ui::history::Snapshot,
    operation: Operation,
    field: TextEdit,
    local_edit: bool,
    parameter: Parameter,
    start: f64,
    unit: f64,
    moved: bool,
}

fn step(parameter: &Parameter) -> f64 {
    if parameter.integer {
        1.
    } else if parameter.max - parameter.min <= 10. {
        0.01
    } else if parameter.max - parameter.min <= 40. {
        0.1
    } else {
        1.
    }
}
fn value(parameter: &Parameter, value: f64) -> String {
    let value = value.clamp(parameter.min, parameter.max);
    if parameter.integer {
        format!("{value:.0}")
    } else {
        let rounded = (value * 1000.).round() / 1000.;
        if rounded == 0. {
            "0".into()
        } else {
            rounded.to_string()
        }
    }
}

impl State {
    fn edit_number(&mut self, id: u64, index: usize) {
        if !self.editable() {
            return;
        }
        self.cancel_number();
        self.active = Some(id);
        if let Some(field) = self
            .fields
            .get_mut(&id)
            .and_then(|fields| fields.get_mut(index))
        {
            field.focused = true;
            field.anchor = 0;
            field.focus = field.text.len();
        }
    }
    fn number_value(&self, id: u64, index: usize) -> Option<(Parameter, f64)> {
        let card = self.cards.iter().find(|card| card.id == id)?;
        let parameter = card.operation.parameters().into_iter().nth(index)?;
        let field = self.fields.get(&id)?.get(index)?;
        let value: f64 = field.text.trim().parse().ok()?;
        (value.is_finite() && (parameter.min..=parameter.max).contains(&value))
            .then_some((parameter, value))
    }
    fn set_number(&mut self, id: u64, index: usize, text: String) -> bool {
        let Some(card) = self.cards.iter_mut().find(|card| card.id == id) else {
            return false;
        };
        let mut values: Vec<_> = card
            .operation
            .parameters()
            .into_iter()
            .map(|p| p.value)
            .collect();
        values[index] = text.clone();
        let Ok(operation) = card.operation.with_parameters(&values) else {
            return false;
        };
        if operation == card.operation {
            return false;
        }
        card.operation = operation;
        if let Some(field) = self
            .fields
            .get_mut(&id)
            .and_then(|fields| fields.get_mut(index))
        {
            let focused = field.focused;
            *field = TextEdit::new(text);
            field.focused = focused;
            field.anchor = 0;
            field.focus = field.text.len();
        }
        self.local_edits.remove(&(id, index));
        self.pending_fields.remove(&(id, index));
        self.active = Some(id);
        true
    }
    pub(in crate::ui) fn step_number(&mut self, id: u64, index: usize, delta: i32, fine: bool) {
        if !self.editable() {
            return;
        }
        let Some((parameter, start)) = self.number_value(id, index) else {
            return;
        };
        let unit = step(&parameter) * if fine && !parameter.integer { 0.1 } else { 1. };
        let before = self.snapshot();
        if self.set_number(id, index, value(&parameter, start + delta as f64 * unit)) {
            self.commit_edit(before, format!("Change {}", parameter.label), Some(id));
        }
    }
    fn drag_number(&mut self, id: u64, index: usize, drag: &Drag, tx: &mut Tx) {
        match drag.phase {
            Phase::Down => {
                if !self.editable() {
                    return;
                }
                let Some((parameter, start)) = self.number_value(id, index) else {
                    return;
                };
                self.cancel_number();
                self.pending_fields.remove(&(id, index));
                self.close_color();
                self.active = Some(id);
                let unit = step(&parameter) * if tx.mods().shift { 0.1 } else { 1. };
                self.number = Some(Gesture {
                    id,
                    index,
                    parameter,
                    start,
                    unit,
                    moved: false,
                    before: self.snapshot(),
                    operation: self
                        .cards
                        .iter()
                        .find(|card| card.id == id)
                        .expect("Number card")
                        .operation
                        .clone(),
                    field: self.fields[&id][index].clone(),
                    local_edit: self.local_edits.contains(&(id, index)),
                });
                tx.instant();
            }
            Phase::Move => {
                let Some(gesture) = &mut self.number else {
                    return;
                };
                if !gesture.moved && drag.dx.abs().max(drag.dy.abs()) < 3. {
                    return;
                }
                if !gesture.moved {
                    if let Some(field) = self
                        .fields
                        .get_mut(&id)
                        .and_then(|fields| fields.get_mut(index))
                    {
                        field.focused = false;
                    }
                    tx.blur();
                }
                gesture.moved = true;
                let text = value(
                    &gesture.parameter,
                    gesture.start + drag.dx as f64 * gesture.unit,
                );
                if self.set_number(id, index, text) {
                    self.process();
                }
                tx.instant();
            }
            Phase::Up => {
                if drag.cancelled() {
                    self.cancel_number();
                } else if let Some(gesture) = self.number.take() {
                    if gesture.moved {
                        self.commit_edit(
                            gesture.before,
                            format!("Change {}", gesture.parameter.label),
                            None,
                        );
                    } else {
                        self.edit_number(id, index);
                    }
                } else if drag.dx.abs().max(drag.dy.abs()) < 3. {
                    self.edit_number(id, index);
                }
                tx.instant();
            }
        }
    }
    pub(in crate::ui) fn cancel_number(&mut self) {
        let Some(gesture) = self.number.take() else {
            return;
        };
        if let Some(card) = self.cards.iter_mut().find(|card| card.id == gesture.id) {
            let changed = card.operation != gesture.operation;
            card.operation = gesture.operation;
            if let Some(field) = self
                .fields
                .get_mut(&gesture.id)
                .and_then(|fields| fields.get_mut(gesture.index))
            {
                *field = gesture.field;
                field.focused = false;
            }
            if gesture.local_edit {
                self.local_edits.insert((gesture.id, gesture.index));
            } else {
                self.local_edits.remove(&(gesture.id, gesture.index));
            }
            if changed {
                self.process();
            }
        }
    }
}

pub(super) fn control(
    s: &State,
    id: u64,
    index: usize,
    parameter: &Parameter,
    edit: &TextEdit,
    input: El,
    width: f32,
) -> El {
    let current = edit
        .text
        .trim()
        .parse::<f64>()
        .ok()
        .filter(|n| n.is_finite());
    let ratio = current.map_or(0., |n| {
        ((n - parameter.min) / (parameter.max - parameter.min)).clamp(0., 1.)
    }) as f32;
    let dragging = s
        .number
        .as_ref()
        .is_some_and(|gesture| gesture.id == id && gesture.index == index && gesture.moved);
    let fill = el()
        .absolute(0., 0.)
        .w(width * ratio)
        .h(26.)
        .radius(2.)
        .fill(rune::oklch(if dragging { 0.91 } else { 0.95 }, 0., 0.))
        .inert();
    let frame = row()
        .key(format!("number-scrub-{id}-{index}"))
        .instant_changes()
        .w(width)
        .h(26.)
        .radius(2.)
        .border(0.75, if dragging { muted() } else { line() })
        .focus_within_ring(1., -1., muted());
    let pointer = el()
        .key(format!("number-pointer-{id}-{index}"))
        .absolute(0., 0.)
        .size(width, 26.)
        .preserve_focus_on_press(edit.focused)
        .cursor(rune::Cursor::ResizeColumn)
        .a11y_hidden()
        .on_drag(move |s: &mut State, drag, tx| s.drag_number(id, index, drag, tx));
    if edit.focused {
        return frame
            .child(
                input
                    .w(width)
                    .h(26.)
                    .px(6.)
                    .py(5.)
                    .font(rune::tok::type_::LABEL.lh(16.))
                    .color(ink())
                    .caret(ink(), rune::oklch(0.85, 0., 0.)),
            )
            .child(pointer);
    }
    frame.role("slider").label(parameter.label)
        .range_value(current.unwrap_or(parameter.min), parameter.min, parameter.max)
        .range_step(step(parameter))
        .help("Drag anywhere to adjust; hold Shift for finer adjustment. Click or press Enter to type.")
        .cursor(rune::Cursor::ResizeColumn)
        .on_key(move |s: &mut State, event, _| {
            if event.key == Key::Enter {
                s.edit_number(id, index);
                return true;
            }
            if let Key::Text(text) = &event.key
                && !event.mods.cmd && !event.mods.ctrl && !event.mods.alt
                && text.chars().all(|c| c.is_ascii_digit() || matches!(c, '.' | '-' | '+'))
            {
                s.edit_number(id, index);
                if let Some(field) = s.fields.get_mut(&id).and_then(|fields| fields.get_mut(index)) {
                    field.insert(text);
                    s.queue_field(id, index);
                }
                return true;
            }
            false
        })
        .on_step(move |s: &mut State, delta, _| s.step_number(id, index, delta, false))
        .child(fill)
        .child(row().key(format!("{}-{id}", parameter.key)).w(width).h(26.).px(6.).gap(4.).center_y().inert()
            .child(label(&edit.text).grow(1.).truncate())
            .child(icon(&SCRUB, 12.).color(muted())))
        .child(pointer)
        .blocked(!s.editable())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ui::tests::{add, click, double_click, enter, rect, runtime, settle};
    use rune::Runtime;

    fn key(rt: &mut Runtime<State>, key: Key) {
        rt.key(KeyEvent {
            key,
            mods: Default::default(),
        });
        rt.frame(0.01);
    }
    fn drag(rt: &mut Runtime<State>, dx: f32) {
        let (x, y) = rt.find("number-scrub-1-0").unwrap();
        rt.pointer_down(x, y);
        rt.pointer_move(x + dx * 0.5, y);
        rt.frame(0.01);
        rt.pointer_move(x + dx, y);
        rt.frame(0.01);
        rt.pointer_up(x + dx, y);
        settle(rt);
    }
    #[test]
    fn scrub_renders_live_and_is_one_undoable_action() {
        let mut rt = runtime((980., 820.), false);
        add(&mut rt, "Resize");
        let original = rt.state.cards[0].operation.clone();
        let start: u32 = original.parameters()[0].value.parse().unwrap();
        let (x, y) = rt.find("number-scrub-1-0").unwrap();
        rt.pointer_down(x, y);
        for offset in [10., 20., 35.] {
            rt.pointer_move(x + offset, y);
            rt.frame(0.01);
        }
        assert_eq!(rt.state.history.undo_label(), Some("Add Resize"));
        settle(&mut rt);
        assert_eq!(
            rt.state.displayed.as_ref().unwrap().frames[0]
                .pixels
                .width(),
            start + 35
        );
        rt.pointer_up(x + 35., y);
        settle(&mut rt);
        let changed = rt.state.cards[0].operation.clone();
        assert_eq!(changed.parameters()[0].value, (start + 35).to_string());
        rt.state.undo();
        settle(&mut rt);
        assert_eq!(rt.state.cards[0].operation, original);
        assert_eq!(rt.state.history.undo_label(), Some("Add Resize"));
        rt.state.redo();
        settle(&mut rt);
        assert_eq!(rt.state.cards[0].operation, changed);
    }
    #[test]
    fn fractional_scrub_clamps_both_ends_without_rounding_to_integers() {
        let mut rt = runtime((980., 820.), false);
        add(&mut rt, "Gamma");
        drag(&mut rt, 17.);
        assert_eq!(
            rt.state.cards[0].operation,
            Operation::Gamma { gamma: 1.37 }
        );
        drag(&mut rt, 1000.);
        assert_eq!(rt.state.cards[0].operation, Operation::Gamma { gamma: 5. });
        drag(&mut rt, -1000.);
        assert_eq!(rt.state.cards[0].operation, Operation::Gamma { gamma: 0.1 });
    }
    #[test]
    fn escape_and_window_blur_restore_value_without_history() {
        for blur in [false, true] {
            let mut rt = runtime((980., 820.), false);
            add(&mut rt, "Brightness");
            let original = rt.state.cards[0].operation.clone();
            let label = rt.state.history.undo_label().unwrap().to_owned();
            let (x, y) = rt.find("number-scrub-1-0").unwrap();
            rt.pointer_down(x, y);
            rt.pointer_move(x + 30., y);
            rt.frame(0.01);
            assert_ne!(rt.state.cards[0].operation, original);
            if blur {
                rt.window_focus(false);
            } else {
                key(&mut rt, Key::Escape);
            }
            rt.pointer_up(x + 30., y);
            settle(&mut rt);
            assert_eq!(rt.state.cards[0].operation, original);
            assert_eq!(rt.state.fields[&1][0].text, original.parameters()[0].value);
            assert_eq!(rt.state.history.undo_label(), Some(label.as_str()));
            assert!(rt.state.number.is_none());
        }
    }
    #[test]
    fn scrub_preserves_other_unsubmitted_fields_and_rejects_invalid_start() {
        let mut rt = runtime((980., 820.), false);
        add(&mut rt, "Resize");
        let original = rt.state.cards[0].operation.clone();
        rt.state.fields.get_mut(&1).unwrap()[1] = TextEdit::new("not a height");
        rt.invalidate();
        rt.frame(0.01);
        drag(&mut rt, 20.);
        assert_eq!(rt.state.fields[&1][1].text, "not a height");
        rt.state.undo();
        settle(&mut rt);
        assert_eq!(rt.state.cards[0].operation, original);
        assert_eq!(rt.state.fields[&1][1].text, "not a height");
        rt.state.fields.get_mut(&1).unwrap()[0] = TextEdit::new("-");
        rt.invalidate();
        rt.frame(0.01);
        drag(&mut rt, 20.);
        assert_eq!(rt.state.fields[&1][0].text, "-");
        assert_eq!(rt.state.cards[0].operation, original);
    }
    #[test]
    fn single_click_types_and_numeric_arrows_keep_normal_text_editing() {
        let mut rt = runtime((980., 820.), false);
        add(&mut rt, "Gamma");
        click(&mut rt, "number-scrub-1-0");
        assert!(rt.state.fields[&1][0].focused);
        key(&mut rt, Key::Text("2.5".into()));
        key(&mut rt, Key::Enter);
        settle(&mut rt);
        assert_eq!(rt.state.cards[0].operation, Operation::Gamma { gamma: 2.5 });
        enter(&mut rt, "gamma-1", "1.75");
        assert!(!rt.state.fields[&1][0].focused);
        double_click(&mut rt, "gamma-1");
        key(&mut rt, Key::Up);
        settle(&mut rt);
        assert_eq!(
            rt.state.cards[0].operation,
            Operation::Gamma { gamma: 1.76 }
        );
        assert!(rt.state.fields[&1][0].focused);
    }
    #[test]
    fn dragging_digits_and_both_padding_edges_always_scrubs() {
        let mut rt = runtime((980., 820.), false);
        add(&mut rt, "Brightness");
        let [x, y, w, h] = rect(&rt, "amount-1");
        for offset in [2., 16., w - 2.] {
            let (x, y) = (x + offset, y + h / 2.);
            rt.pointer_down(x, y);
            rt.pointer_up(x, y);
            rt.frame(0.01);
            assert!(rt.state.fields[&1][0].focused);
            rt.pointer_down(x, y);
            rt.frame(0.01);
            rt.pointer_move(x + 12., y);
            rt.frame(0.01);
            rt.pointer_up(x + 12., y);
            settle(&mut rt);
            assert_eq!(
                rt.state.cards[0].operation,
                Operation::Brightness { amount: 32 }
            );
            assert!(!rt.state.fields[&1][0].focused);
            rt.state.undo();
            settle(&mut rt);
        }
    }
    #[test]
    fn single_click_editing_and_escape_restore_the_applied_value() {
        let mut rt = runtime((980., 820.), false);
        add(&mut rt, "Gamma");
        click(&mut rt, "gamma-1");
        assert!(rt.state.fields[&1][0].focused);
        key(&mut rt, Key::Text("2.5".into()));
        assert_eq!(rt.state.fields[&1][0].text, "2.5");
        key(&mut rt, Key::Escape);
        assert!(!rt.state.fields[&1][0].focused);
        assert_eq!(rt.state.fields[&1][0].text, "1.2");
        assert_eq!(rt.state.cards[0].operation, Operation::Gamma { gamma: 1.2 });
        assert_eq!(rt.state.history.undo_label(), Some("Add Gamma"));
    }
}
