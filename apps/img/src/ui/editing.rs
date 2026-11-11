use super::*;

#[derive(Clone, Copy)]
pub(super) enum Action {
    Undo,
    Redo,
    Cut,
    Copy,
    Paste,
    Duplicate,
    CopyAll,
    CopyFrame,
    Delete,
}
pub(super) fn command(event: &KeyEvent) -> Option<char> {
    if event.mods.alt || (cfg!(target_os = "macos") && event.mods.ctrl) {
        return None;
    }
    if let Key::Command(key) = event.key {
        Some(key.to_ascii_lowercase())
    } else {
        None
    }
}
impl State {
    pub(super) fn edit_action(&mut self, action: Action, tx: &mut Tx) {
        if let Some(gesture) = &self.spatial {
            let committed = gesture.committed;
            self.cancel_spatial();
            if !committed && matches!(action, Action::Undo | Action::Redo) {
                return;
            }
        }
        if self.number.is_some() {
            self.cancel_number();
            if matches!(action, Action::Undo | Action::Redo) {
                return;
            }
        }
        if !matches!(action, Action::Copy | Action::CopyAll | Action::CopyFrame) {
            self.flush_fields(tx);
        }
        self.edit_open = false;
        self.edit_at = None;
        match action {
            Action::Undo => self.undo(),
            Action::Redo => self.redo(),
            Action::Copy if self.active_card().is_none() => self.copy_frame(tx),
            Action::Copy => self.copy_operations(false, false, tx),
            Action::Cut => self.copy_operations(false, true, tx),
            Action::Paste => self.paste_clipboard(tx),
            Action::Duplicate => self.duplicate(),
            Action::CopyAll => self.copy_operations(true, false, tx),
            Action::CopyFrame => self.copy_frame(tx),
            Action::Delete => {
                if let Some(card) = self.active_card() {
                    self.remove(card.id);
                }
            }
        }
        if !matches!(action, Action::Copy | Action::CopyAll | Action::CopyFrame) {
            tx.blur();
        }
    }
    pub(super) fn editing_key(&mut self, event: &KeyEvent, tx: &mut Tx) -> bool {
        let field = self.fields.values().flatten().any(|field| field.focused);
        let key = command(event);
        let action = match key {
            _ if !field
                && matches!(event.key, Key::Backspace | Key::Delete)
                && !event.mods.alt
                && !event.mods.cmd
                && !event.mods.ctrl =>
            {
                Action::Delete
            }
            Some('c') if event.mods.shift => Action::CopyFrame,
            Some('v') if event.mods.shift => Action::Paste,
            Some('d') if !event.mods.shift => Action::Duplicate,
            _ if field => return false,
            Some('z') if event.mods.shift => Action::Redo,
            Some('z') => Action::Undo,
            Some('y') if !cfg!(target_os = "macos") => Action::Redo,
            Some('x') if !event.mods.shift => Action::Cut,
            Some('c') if !event.mods.shift => Action::Copy,
            Some('v') if !event.mods.shift => Action::Paste,
            _ => return false,
        };
        if matches!(action, Action::Undo)
            && self
                .placement
                .as_ref()
                .is_some_and(|gesture| !gesture.committed)
        {
            self.cancel_placement();
            return true;
        }
        if self.dragging.is_some() {
            self.dragging = None;
            return true;
        }
        self.edit_action(action, tx);
        true
    }
    pub(super) fn operation_context(&mut self, id: u64, press: rune::PointerPress) {
        self.active = Some(id);
        self.edit_open = true;
        self.edit_at = Some([press.x, press.y]);
    }
}

pub(super) fn native_items() -> Vec<rune::MenuItem<State>> {
    vec![
        rune::MenuItem::new("Duplicate Operation", |s: &mut State, tx| {
            s.edit_action(Action::Duplicate, tx)
        })
        .key_equivalent("mod+d".parse().expect("Duplicate shortcut"))
        .keys_first()
        .id("duplicate-operation")
        .menu("Edit"),
        rune::MenuItem::new("Copy All Operations", |s: &mut State, tx| {
            s.edit_action(Action::CopyAll, tx)
        })
        .id("copy-all-operations")
        .menu("Edit"),
        rune::MenuItem::new("Copy Preview Frame", |s: &mut State, tx| {
            s.edit_action(Action::CopyFrame, tx)
        })
        .key_equivalent("mod+shift+c".parse().expect("Copy frame shortcut"))
        .keys_first()
        .id("copy-preview-frame")
        .menu("Edit"),
        rune::MenuItem::new("Paste into Stack", |s: &mut State, tx| {
            s.edit_action(Action::Paste, tx)
        })
        .key_equivalent("mod+shift+v".parse().expect("Paste shortcut"))
        .keys_first()
        .id("paste-operations")
        .menu("Edit"),
    ]
}
