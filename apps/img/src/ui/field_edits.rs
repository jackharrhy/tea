use super::*;

const DEBOUNCE: f64 = 0.35;
#[derive(Clone, Copy)]
pub(super) enum Pending {
    Queued,
    At(f64),
    Invalid,
}

impl State {
    pub(super) fn apply_parameters(&mut self, id: u64, indices: &[usize]) {
        if self.worker.is_io() || !self.cards.iter().any(|card| card.id == id) {
            return;
        }
        if let Err(error) = self.commit_fields(id, indices, true) {
            self.status = format!("Error: {error}");
        }
    }
    fn commit_fields(&mut self, id: u64, indices: &[usize], finish: bool) -> anyhow::Result<()> {
        let card = self
            .cards
            .iter()
            .find(|card| card.id == id)
            .ok_or_else(|| anyhow::anyhow!("Operation no longer exists"))?;
        let fields = self
            .fields
            .get(&id)
            .ok_or_else(|| anyhow::anyhow!("Operation fields no longer exist"))?;
        let mut values: Vec<_> = card
            .operation
            .parameters()
            .into_iter()
            .map(|parameter| parameter.value)
            .collect();
        for &index in indices {
            values[index] = fields[index].text.clone();
        }
        let operation = card.operation.with_parameters(&values)?;
        for &index in indices {
            self.pending_fields.remove(&(id, index));
            if finish {
                self.local_edits.remove(&(id, index));
                self.fields.get_mut(&id).expect("Operation fields")[index].clear_history();
            }
        }
        let label = format!("Change {}", operation.name());
        self.edit_operation(id, operation, label, None);
        Ok(())
    }
    pub(super) fn flush_fields(&mut self, tx: &mut Tx) {
        if self.pending_fields.is_empty() {
            return;
        }
        for &(id, index) in self.pending_fields.keys() {
            if let Some(field) = self
                .fields
                .get_mut(&id)
                .and_then(|fields| fields.get_mut(index))
            {
                field.focused = false;
            }
        }
        tx.blur();
        self.poll_fields(self.clock.unwrap_or(0.), tx);
    }
    pub(super) fn queue_field(&mut self, id: u64, index: usize) {
        self.local_edits.insert((id, index));
        self.pending_fields.insert((id, index), Pending::Queued);
    }
    pub(super) fn poll_fields(&mut self, now: f64, tx: &mut Tx) -> bool {
        if !self.editable() {
            return false;
        }
        let pending: Vec<_> = self
            .pending_fields
            .iter()
            .map(|(&key, &pending)| (key, pending))
            .collect();
        let mut changed = false;
        for ((id, index), pending) in pending {
            let Some(field) = self.fields.get(&id).and_then(|fields| fields.get(index)) else {
                self.pending_fields.remove(&(id, index));
                continue;
            };
            let focused = field.focused;
            let due = match pending {
                Pending::Queued => now + DEBOUNCE,
                Pending::At(time) => time,
                Pending::Invalid => f64::INFINITY,
            };
            if focused && now < due {
                if due.is_finite() {
                    self.pending_fields.insert((id, index), Pending::At(due));
                    tx.wake_after(Duration::from_secs_f64(due - now));
                }
                continue;
            }
            match self.commit_fields(id, &[index], !focused) {
                Ok(()) => {
                    changed = true;
                }
                Err(error) if !focused => {
                    self.status = format!("Error: {error}");
                    self.pending_fields.remove(&(id, index));
                    changed = true;
                }
                Err(_) => {
                    self.pending_fields.insert((id, index), Pending::Invalid);
                }
            }
        }
        changed
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ui::tests::{add, click, double_click, enter, runtime, settle};
    use rune::Runtime;

    fn type_value(rt: &mut Runtime<State>, text: &str) {
        rt.key(KeyEvent {
            key: Key::Command('a'),
            mods: Default::default(),
        });
        rt.key(KeyEvent {
            key: Key::Text(text.into()),
            mods: Default::default(),
        });
        rt.frame(0.01);
    }
    #[test]
    fn explicit_edits_do_not_commit_or_get_blocked_by_unrelated_invalid_fields() {
        let mut rt = runtime((980., 820.), false);
        add(&mut rt, "Resize");
        let height = rt.state.cards[0].operation.parameters()[1].value.clone();
        rt.state.fields.get_mut(&1).unwrap()[1] = TextEdit::new("-");
        enter(&mut rt, "width-1", "80");
        assert_eq!(rt.state.cards[0].operation.parameters()[0].value, "80");
        assert_eq!(rt.state.cards[0].operation.parameters()[1].value, height);
        assert_eq!(rt.state.fields[&1][1].text, "-");
        add(&mut rt, "Text caption");
        rt.state.fields.get_mut(&2).unwrap()[3] = TextEdit::new("-");
        click(&mut rt, "color-2");
        enter(&mut rt, "color-hex", "#123456");
        assert!(matches!(
            rt.state.cards[1].operation,
            Operation::Text {
                red: 0x12,
                green: 0x34,
                blue: 0x56,
                ..
            }
        ));
        assert_eq!(rt.state.fields[&2][3].text, "-");
    }
    #[test]
    fn debounce_restarts_while_typing_and_keeps_caret_and_text_undo() {
        let mut rt = runtime((980., 820.), false);
        add(&mut rt, "Gamma");
        double_click(&mut rt, "gamma-1");
        type_value(&mut rt, "2.5");
        rt.frame(0.2);
        assert_eq!(rt.state.cards[0].operation, Operation::Gamma { gamma: 1.2 });
        assert!(!rt.state.ready());
        type_value(&mut rt, "3.1");
        rt.frame(0.2);
        assert_eq!(rt.state.cards[0].operation, Operation::Gamma { gamma: 1.2 });
        rt.frame(0.2);
        settle(&mut rt);
        assert_eq!(rt.state.cards[0].operation, Operation::Gamma { gamma: 3.1 });
        assert!(rt.state.fields[&1][0].focused);
        assert_eq!(rt.state.fields[&1][0].focus, 3);
        rt.key(KeyEvent {
            key: Key::Command('z'),
            mods: Default::default(),
        });
        rt.frame(0.01);
        assert_eq!(rt.state.fields[&1][0].text, "2.5");
        rt.frame(0.4);
        settle(&mut rt);
        assert_eq!(rt.state.cards[0].operation, Operation::Gamma { gamma: 2.5 });
        assert!(rt.state.status.is_empty());
    }
    #[test]
    fn blur_applies_captions_immediately_and_document_undo_restores_them() {
        let mut rt = runtime((980., 820.), false);
        add(&mut rt, "Text caption");
        click(&mut rt, "text-1");
        type_value(&mut rt, "A new caption");
        assert!(
            matches!(&rt.state.cards[0].operation, Operation::Text { text, .. } if text == "Text")
        );
        click(&mut rt, "fit");
        assert!(
            matches!(&rt.state.cards[0].operation, Operation::Text { text, .. } if text == "A new caption")
        );
        assert!(rt.state.pending_fields.is_empty());
        rt.state.undo();
        settle(&mut rt);
        assert!(
            matches!(&rt.state.cards[0].operation, Operation::Text { text, .. } if text == "Text")
        );
        rt.frame(1.);
        assert_eq!(rt.state.fields[&1][0].text, "Text");
    }
    #[test]
    fn incomplete_values_wait_for_correction_and_escape_discards_pending_edits() {
        let mut rt = runtime((980., 820.), false);
        add(&mut rt, "Gamma");
        double_click(&mut rt, "gamma-1");
        type_value(&mut rt, "-");
        rt.frame(0.5);
        assert_eq!(rt.state.cards[0].operation, Operation::Gamma { gamma: 1.2 });
        assert!(rt.state.status.is_empty());
        assert!(!rt.state.worker.busy());
        let (x, y) = rt.find("fit").unwrap();
        rt.pointer_down(x, y);
        rt.pointer_up(x, y);
        rt.frame(0.01);
        rt.frame(0.01);
        assert!(rt.state.status.starts_with("Error:"));
        assert!(rt.state.pending_fields.is_empty());
        rt.state.status.clear();
        double_click(&mut rt, "gamma-1");
        type_value(&mut rt, "2.75");
        rt.key(KeyEvent {
            key: Key::Escape,
            mods: Default::default(),
        });
        rt.frame(0.5);
        assert_eq!(rt.state.cards[0].operation, Operation::Gamma { gamma: 1.2 });
        assert_eq!(rt.state.fields[&1][0].text, "1.2");
        assert!(rt.state.pending_fields.is_empty());
    }
    #[test]
    fn clicking_undo_before_the_debounce_undoes_the_field_edit() {
        let mut rt = runtime((980., 820.), false);
        add(&mut rt, "Gamma");
        double_click(&mut rt, "gamma-1");
        type_value(&mut rt, "2.5");
        click(&mut rt, "undo");
        assert_eq!(rt.state.cards.len(), 1);
        assert_eq!(rt.state.cards[0].operation, Operation::Gamma { gamma: 1.2 });
        assert!(rt.state.pending_fields.is_empty());
        rt.state.redo();
        settle(&mut rt);
        assert_eq!(rt.state.cards[0].operation, Operation::Gamma { gamma: 2.5 });
    }
}
