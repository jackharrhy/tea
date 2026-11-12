use super::super::editing::Action;
use super::*;
use rune_kit::{Menu, MenuItem};

pub(super) fn toolbar(s: &State, overlays: &mut Vec<El>) -> El {
    let undo = s
        .history
        .undo_label()
        .map_or("Undo".into(), |label| format!("Undo {label}"));
    let redo = s
        .history
        .redo_label()
        .map_or("Redo".into(), |label| format!("Redo {label}"));
    let can_edit = s.editable();
    let can_history = !s.worker.is_io();
    let has_card = s.active_card().is_some();
    let shortcuts = if cfg!(target_os = "macos") {
        ["⌘Z", "⇧⌘Z", "⌘X", "⌘C", "⌘V", "⌘D", "⇧⌘C"]
    } else {
        [
            "Ctrl+Z",
            "Ctrl+Shift+Z",
            "Ctrl+X",
            "Ctrl+C",
            "Ctrl+V",
            "Ctrl+D",
            "Ctrl+Shift+C",
        ]
    };
    let item = |label: String, action: Action, enabled: bool, shortcut: &str| {
        MenuItem::new(label)
            .shortcut(shortcut)
            .disabled(!enabled)
            .on_select_tx(move |s: &mut State, tx| s.edit_action(action, tx))
    };
    let trigger = button("edit", "Edit", |s, _| {
        s.edit_at = None;
        s.edit_open = !s.edit_open;
    });
    let mut menu = Menu::new("edit-menu")
        .min_width(284.)
        .trigger(trigger)
        .open(s.edit_open)
        .placement(rune_kit::Placement::BottomStart)
        .on_close(|s: &mut State| {
            s.edit_open = false;
            s.edit_at = None;
        })
        .item(item(
            undo.clone(),
            Action::Undo,
            can_history && s.history.undo_label().is_some(),
            shortcuts[0],
        ))
        .item(item(
            redo.clone(),
            Action::Redo,
            can_history && s.history.redo_label().is_some(),
            shortcuts[1],
        ))
        .separator()
        .item(item(
            "Cut operation".into(),
            Action::Cut,
            can_edit && has_card,
            shortcuts[2],
        ))
        .item(item(
            "Copy operation".into(),
            Action::Copy,
            has_card,
            shortcuts[3],
        ))
        .item(item(
            "Paste".into(),
            Action::Paste,
            !s.worker.is_io(),
            shortcuts[4],
        ))
        .item(item(
            "Duplicate operation".into(),
            Action::Duplicate,
            can_edit && has_card && s.cards.len() < img::MAX_OPERATIONS,
            shortcuts[5],
        ))
        .item(item(
            "Delete operation".into(),
            Action::Delete,
            can_edit && has_card,
            "",
        ))
        .separator()
        .item(item(
            "Copy all operations".into(),
            Action::CopyAll,
            has_card,
            "",
        ))
        .item(item(
            "Copy preview frame".into(),
            Action::CopyFrame,
            s.displayed.is_some(),
            shortcuts[6],
        ));
    if let Some([x, y]) = s.edit_at {
        menu = menu.at(x, y);
    }
    row()
        .key("edit-toolbar")
        .w_full()
        .h(24.)
        .gap(4.)
        .center_y()
        .child(
            icon_button("undo", undo, &UNDO, |s, tx| s.edit_action(Action::Undo, tx))
                .blocked(!can_history || s.history.undo_label().is_none()),
        )
        .child(
            icon_button("redo", redo, &REDO, |s, tx| s.edit_action(Action::Redo, tx))
                .blocked(!can_history || s.history.redo_label().is_none()),
        )
        .child(el().grow(1.))
        .child(menu.build(&kit(), overlays))
}
