use super::*;
use std::{collections::HashSet, time::Instant};

const MAX_EDITS: usize = 100;
const MAX_HISTORY_BYTES: usize = 16 * 1024 * 1024;
#[derive(Clone)]
pub(super) struct Snapshot {
    pub cards: Vec<Card>,
    source: Option<Arc<Animation>>,
    name: String,
    drafts: std::collections::HashMap<(u64, usize), String>,
    selected: Option<u64>,
    active: Option<u64>,
    collapsed: HashSet<u64>,
    details: HashSet<(u64, &'static str)>,
}
impl Snapshot {
    fn bytes(&self) -> usize {
        self.cards
            .iter()
            .map(|card| {
                std::mem::size_of::<Card>()
                    + card
                        .operation
                        .parameters()
                        .iter()
                        .map(|p| p.value.len())
                        .sum::<usize>()
            })
            .sum::<usize>()
            + self.name.len()
            + self
                .drafts
                .values()
                .map(|value| value.len() + 48)
                .sum::<usize>()
    }
}
struct Edit {
    before: Snapshot,
    after: Snapshot,
    label: String,
    nudge: Option<u64>,
    at: Instant,
    bytes: usize,
}
#[derive(Default)]
pub(super) struct History {
    edits: Vec<Edit>,
    cursor: usize,
    bytes: usize,
}
impl History {
    fn past_source_bytes(&self) -> usize {
        let mut seen = HashSet::new();
        if let Some(source) = self
            .edits
            .last()
            .and_then(|edit| edit.after.source.as_ref())
        {
            seen.insert(Arc::as_ptr(source));
        }
        self.edits
            .iter()
            .flat_map(|edit| [&edit.before, &edit.after])
            .filter_map(|snapshot| snapshot.source.as_ref())
            .filter(|source| seen.insert(Arc::as_ptr(source)))
            .map(|source| source.bytes())
            .sum()
    }
    pub fn undo_label(&self) -> Option<&str> {
        self.cursor
            .checked_sub(1)
            .map(|index| self.edits[index].label.as_str())
    }
    pub fn asset_paths(&self) -> HashSet<String> {
        self.edits
            .iter()
            .flat_map(|edit| edit.before.cards.iter().chain(edit.after.cards.iter()))
            .filter_map(|card| {
                if let Operation::Overlay { path, .. } = &card.operation {
                    Some(path.clone())
                } else {
                    None
                }
            })
            .collect()
    }
    pub fn redo_label(&self) -> Option<&str> {
        self.edits.get(self.cursor).map(|edit| edit.label.as_str())
    }
    fn record(
        &mut self,
        before: Snapshot,
        after: Snapshot,
        label: String,
        nudge: Option<u64>,
    ) -> bool {
        let same_source = match (&before.source, &after.source) {
            (Some(a), Some(b)) => Arc::ptr_eq(a, b),
            (None, None) => true,
            _ => false,
        };
        if before.cards == after.cards && same_source {
            return false;
        }
        let branching = self.cursor != self.edits.len();
        self.bytes -= self.edits[self.cursor..]
            .iter()
            .map(|edit| edit.bytes)
            .sum::<usize>();
        self.edits.truncate(self.cursor);
        let now = Instant::now();
        if !branching
            && nudge.is_some()
            && let Some(previous) = self.edits.last_mut()
            && previous.nudge == nudge
            && now.duration_since(previous.at) < Duration::from_millis(500)
        {
            self.bytes -= previous.bytes;
            previous.after = after;
            previous.bytes = previous.before.bytes() + previous.after.bytes();
            self.bytes += previous.bytes;
            previous.at = now;
        } else {
            let bytes = before.bytes() + after.bytes();
            self.bytes += bytes;
            self.edits.push(Edit {
                bytes,
                before,
                after,
                label,
                nudge,
                at: now,
            });
        }
        while self.edits.len() > MAX_EDITS
            || (self.edits.len() > 1
                && (self.bytes > MAX_HISTORY_BYTES || self.past_source_bytes() > img::MAX_BYTES))
        {
            let edit = self.edits.remove(0);
            self.bytes -= edit.bytes;
        }
        self.cursor = self.edits.len();
        true
    }
}
impl State {
    pub(super) fn snapshot(&self) -> Snapshot {
        let mut drafts = std::collections::HashMap::new();
        for card in &self.cards {
            if let Some(fields) = self.fields.get(&card.id) {
                for (index, (parameter, field)) in
                    card.operation.parameters().iter().zip(fields).enumerate()
                {
                    if parameter.value != field.text {
                        drafts.insert((card.id, index), field.text.clone());
                    }
                }
            }
        }
        Snapshot {
            drafts,
            source: self.source.clone(),
            name: self.name.clone(),
            cards: self.cards.clone(),
            selected: self.selected,
            active: self.active,
            collapsed: self.collapsed.clone(),
            details: self.details.clone(),
        }
    }
    pub(super) fn commit_edit(
        &mut self,
        before: Snapshot,
        label: impl Into<String>,
        nudge: Option<u64>,
    ) {
        let after = self.snapshot();
        if self.history.record(before, after, label.into(), nudge) {
            self.prune_clipboard_assets();
            self.process();
        }
    }
    pub(super) fn edit_operation(
        &mut self,
        id: u64,
        operation: Operation,
        label: impl Into<String>,
        nudge: Option<u64>,
    ) {
        let mut before = self.snapshot();
        let Some(card) = self.cards.iter_mut().find(|card| card.id == id) else {
            return;
        };
        let old = card.operation.parameters();
        let new = operation.parameters();
        before.drafts.retain(|(card, index), _| {
            *card != id
                || old
                    .get(*index)
                    .zip(new.get(*index))
                    .is_some_and(|(a, b)| a.value == b.value)
        });
        card.operation = operation;
        if let Some(fields) = self.fields.get_mut(&id) {
            for (index, (old, new)) in old.iter().zip(&new).enumerate() {
                if old.value != new.value
                    && let Some(field) = fields.get_mut(index)
                    && field.text == old.value
                {
                    *field = TextEdit::new(&new.value);
                }
            }
        }
        self.active = Some(id);
        self.commit_edit(before, label, nudge);
    }
    pub(super) fn editable(&self) -> bool {
        self.source.is_some() && (!self.worker.is_io())
    }
    pub(super) fn undo(&mut self) {
        if self.number.is_some() {
            self.cancel_number();
            return;
        }
        if (self.worker.is_io()) || self.history.cursor == 0 {
            return;
        }
        self.history.cursor -= 1;
        let snapshot = self.history.edits[self.history.cursor].before.clone();
        self.restore(snapshot);
    }
    pub(super) fn redo(&mut self) {
        self.cancel_number();
        if (self.worker.is_io()) || self.history.cursor >= self.history.edits.len() {
            return;
        }
        let snapshot = self.history.edits[self.history.cursor].after.clone();
        self.history.cursor += 1;
        self.restore(snapshot);
    }
    fn restore(&mut self, snapshot: Snapshot) {
        self.cancel_spatial();
        self.cancel_placement();
        self.finish_placement();
        self.dragging = None;
        self.close_color();
        self.picker.close();
        let changed_source = match (&self.source, &snapshot.source) {
            (Some(a), Some(b)) => !Arc::ptr_eq(a, b),
            (None, None) => false,
            _ => true,
        };
        self.source = snapshot.source;
        self.name = snapshot.name;
        if changed_source {
            self.outputs = Default::default();
        }
        self.cards = snapshot.cards;
        self.selected = snapshot
            .selected
            .filter(|id| *id == 0 || self.cards.iter().any(|card| card.id == *id));
        self.active = snapshot
            .active
            .filter(|id| self.cards.iter().any(|card| card.id == *id));
        self.collapsed = snapshot.collapsed;
        self.details = snapshot.details;
        self.rebuild_fields();
        for ((id, index), value) in snapshot.drafts {
            if let Some(field) = self
                .fields
                .get_mut(&id)
                .and_then(|fields| fields.get_mut(index))
            {
                field.anchor = 0;
                field.focus = field.text.len();
                field.insert(&value);
                self.local_edits.insert((id, index));
            }
        }
        self.prune_clipboard_assets();
        if self.source.is_none() {
            self.refresh();
        } else {
            self.process();
        }
    }
    pub(super) fn rebuild_fields(&mut self) {
        self.pending_fields.clear();
        self.fields.clear();
        self.local_edits.clear();
        self.font_pickers.clear();
        self.font_styles.clear();
        self.font_visible.clear();
        for card in &self.cards {
            self.fields.insert(
                card.id,
                card.operation
                    .parameters()
                    .iter()
                    .map(|p| TextEdit::new(&p.value))
                    .collect(),
            );
            if matches!(card.operation, Operation::Text { .. }) {
                self.font_pickers.insert(card.id, Default::default());
                self.font_styles.insert(card.id, Default::default());
            }
        }
    }
    pub(super) fn parameter_key(
        &mut self,
        id: u64,
        index: usize,
        event: &KeyEvent,
        tx: &mut Tx,
    ) -> bool {
        if self.local_edits.contains(&(id, index)) {
            return false;
        }
        if self.worker.is_io() {
            return false;
        }
        match super::editing::command(event) {
            Some('z') if event.mods.shift && self.history.redo_label().is_some() => self.redo(),
            Some('z') if !event.mods.shift && self.history.undo_label().is_some() => self.undo(),
            Some('y') if !cfg!(target_os = "macos") && self.history.redo_label().is_some() => {
                self.redo()
            }
            _ => return false,
        }
        tx.blur();
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn history_is_bounded_and_noop_edits_do_not_erase_redo() {
        let mut state = State::empty();
        state.cards.push(Card {
            id: 1,
            enabled: true,
            operation: Operation::Speed { percent: 100. },
        });
        let mut history = History::default();
        for value in 1..=120 {
            let before = state.snapshot();
            state.cards[0].operation = Operation::Speed {
                percent: value as f32,
            };
            history.record(before, state.snapshot(), "Speed".into(), None);
        }
        assert_eq!(history.edits.len(), MAX_EDITS);
        assert!(history.bytes <= MAX_HISTORY_BYTES);
        history.cursor -= 1;
        let snapshot = history.edits[history.cursor].before.clone();
        assert!(!history.record(snapshot.clone(), snapshot, "No change".into(), None));
        assert!(history.redo_label().is_some());
    }
    #[test]
    fn long_captions_obey_the_history_byte_budget_before_the_action_limit() {
        let mut state = State::empty();
        let operation = Operation::catalog()
            .into_iter()
            .find(|operation| matches!(operation, Operation::Text { .. }))
            .unwrap();
        state.cards = (0..32)
            .map(|id| Card {
                id,
                enabled: true,
                operation: operation.clone(),
            })
            .collect();
        let mut history = History::default();
        for value in 0..80 {
            let before = state.snapshot();
            for card in &mut state.cards {
                if let Operation::Text { text, .. } = &mut card.operation {
                    *text = format!("{}{}", "🦜".repeat(999), char::from(b'A' + value));
                }
            }
            history.record(before, state.snapshot(), "Caption".into(), None);
        }
        assert!(history.edits.len() < 80);
        assert!(history.bytes <= MAX_HISTORY_BYTES);
        assert_eq!(history.cursor, history.edits.len());
    }
}
