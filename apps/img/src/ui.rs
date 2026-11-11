use img::{Animation, Card, Operation};
use rune::{AppSpec, Key, KeyEvent, Pixels, TextEdit, Tx, Waker};

use std::{
    path::PathBuf,
    sync::{Arc, mpsc},
    time::Duration,
};

enum Completed {
    Loaded(Arc<Animation>, String),
    Processed(img::RenderCache),
    Saved(PathBuf),
}
struct State {
    source: Option<Arc<Animation>>,
    outputs: img::RenderCache,
    cards: Vec<Card>,
    history: history::History,
    clipboard_assets: clipboard::Assets,
    active: Option<u64>,
    edit_open: bool,
    edit_at: Option<[f32; 2]>,
    local_edits: std::collections::HashSet<(u64, usize)>,
    pending_fields: std::collections::HashMap<(u64, usize), field_edits::Pending>,
    next_id: u64,
    selected: Option<u64>,
    displayed: Option<Arc<Animation>>,
    pixels: Pixels,
    frame: usize,
    playing: bool,
    elapsed: f64,
    clock: Option<f64>,
    frames_open: bool,
    dragging: Option<DragState>,
    list: drag::ListLayout,
    picker: rune_kit::ComboboxState,
    font_pickers: std::collections::HashMap<u64, rune_kit::ComboboxState>,
    font_styles: std::collections::HashMap<u64, rune_kit::ComboboxState>,
    font_visible: std::collections::HashMap<u64, std::collections::HashSet<String>>,
    fonts_ready: bool,
    actual_size: bool,
    preview_size: [f32; 2],
    fields: std::collections::HashMap<u64, Vec<TextEdit>>,
    collapsed: std::collections::HashSet<u64>,
    details: std::collections::HashSet<(u64, &'static str)>,
    color: view::color::Picker,
    placement: Option<view::placement::Gesture>,
    number: Option<view::number::Gesture>,
    spatial: Option<view::spatial::Gesture>,
    thumbnails: std::cell::RefCell<std::collections::HashMap<usize, Pixels>>,
    pane_width: f32,
    name: String,
    status: String,
    worker: worker::Worker,
    waker: Option<Waker>,
}
impl State {
    fn empty() -> Self {
        Self {
            source: None,
            outputs: Default::default(),
            cards: vec![],
            history: Default::default(),
            clipboard_assets: Default::default(),
            active: None,
            edit_open: false,
            edit_at: None,
            local_edits: Default::default(),
            pending_fields: Default::default(),
            next_id: 1,
            selected: None,
            displayed: None,
            pixels: Pixels::new(),
            frame: 0,
            playing: true,
            elapsed: 0.,
            clock: None,
            frames_open: false,
            dragging: None,
            list: Default::default(),
            picker: Default::default(),
            font_pickers: Default::default(),
            font_styles: Default::default(),
            font_visible: Default::default(),
            fonts_ready: false,
            actual_size: false,
            preview_size: [0.; 2],
            fields: Default::default(),
            collapsed: Default::default(),
            details: Default::default(),
            color: Default::default(),
            placement: None,
            number: None,
            spatial: None,
            thumbnails: Default::default(),
            pane_width: 360.,
            name: String::new(),
            status: String::new(),
            worker: Default::default(),
            waker: None,
        }
    }
    fn start(
        &mut self,
        kind: worker::Kind,
        job: impl FnOnce() -> Result<Completed, String> + Send + 'static,
    ) {
        debug_assert!(!self.worker.busy());
        self.worker = worker::Worker::spawn(kind, job, self.waker.clone());
        self.status.clear();
    }
    fn request_io(&mut self, job: worker::IoJob) {
        let Some(job) = self.worker.request_io(job) else {
            return;
        };
        match job {
            worker::IoJob::Load(path) => self.load(path),
            worker::IoJob::Save(output, path) => self.start(worker::Kind::Io, move || {
                output
                    .save(&path)
                    .map(|_| Completed::Saved(path))
                    .map_err(|error| format!("{error:#}"))
            }),
        }
    }
    fn load(&mut self, path: PathBuf) {
        self.pending_fields.clear();
        self.cancel_spatial();
        self.cancel_number();
        self.cancel_placement();
        self.finish_placement();
        self.dragging = None;
        self.edit_open = false;
        self.edit_at = None;
        self.close_color();
        self.start(worker::Kind::Io, move || {
            Animation::load_image(&path)
                .map(|a| {
                    Completed::Loaded(
                        Arc::new(a),
                        path.file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .into(),
                    )
                })
                .map_err(|e| format!("{e:#}"))
        });
    }
    fn process(&mut self) {
        if !self.worker.request_render() {
            return;
        }
        let Some(source) = self.source.clone() else {
            return;
        };
        let previous = std::mem::take(&mut self.outputs);
        let displayed = self.displayed.clone();
        let preview = self
            .selected
            .and_then(|id| self.cards.iter().position(|c| c.id == id));
        let cards = self.cards.clone();
        self.start(worker::Kind::Render, move || {
            previous
                .render(source, &cards, preview, displayed)
                .map(Completed::Processed)
                .map_err(|e| format!("{e:#}"))
        });
    }
    fn refresh(&mut self) {
        let selected = self
            .selected
            .unwrap_or_else(|| self.cards.last().map_or(0, |c| c.id));
        self.displayed = if selected == 0 {
            self.source.clone()
        } else {
            self.cards
                .iter()
                .position(|c| c.id == selected)
                .and_then(|i| self.outputs.get(i))
                .cloned()
        };
        self.frame = self
            .displayed
            .as_ref()
            .map_or(0, |animation| self.frame.min(animation.frames.len() - 1));
        self.elapsed = 0.;
        self.clock = None;
        self.thumbnails.borrow_mut().clear();
        self.upload();
    }
    fn thumbnail(&self, index: usize) -> Pixels {
        let mut cache = self.thumbnails.borrow_mut();
        cache
            .entry(index)
            .or_insert_with(|| {
                let frame = &self.displayed.as_ref().expect("Visible animation").frames[index];
                let thumb = image::imageops::thumbnail(frame.pixels.as_ref(), 80, 56);
                let pixels = Pixels::new();
                pixels.set(thumb.width(), thumb.height(), preview_rgba(&thumb));
                pixels
            })
            .clone()
    }
    fn upload(&self) {
        if let Some(animation) = &self.displayed {
            let frame = &animation.frames[self.frame];
            self.pixels.set(
                frame.pixels.width(),
                frame.pixels.height(),
                preview_rgba(&frame.pixels),
            );
        }
    }
    fn add(&mut self, operation: Operation) {
        if !self.editable() || self.cards.len() >= img::MAX_OPERATIONS {
            return;
        }
        let before = self.snapshot();
        let label = format!("Add {}", operation.name());
        self.collapsed.extend(self.cards.iter().map(|card| card.id));
        self.collapsed.insert(0);
        if matches!(operation, Operation::Text { .. }) {
            self.font_pickers.insert(self.next_id, Default::default());
            self.font_styles.insert(self.next_id, Default::default());
        }
        let parameters = operation.parameters();
        if !parameters.is_empty() {
            self.fields.insert(
                self.next_id,
                parameters.iter().map(|p| TextEdit::new(&p.value)).collect(),
            );
        }
        self.picker.open = false;
        self.cards.push(Card {
            id: self.next_id,
            enabled: true,
            operation,
        });
        self.active = Some(self.next_id);
        self.next_id += 1;
        self.selected = None;
        self.commit_edit(before, label, None);
    }
    fn toggle_collapsed(&mut self, id: u64) {
        if id != 0 {
            self.active = Some(id);
        }
        self.close_color();
        if !self.collapsed.remove(&id) {
            self.collapsed.insert(id);
        }
        if id != 0 {
            self.active = Some(id);
        }
    }
    fn toggle_detail(&mut self, id: u64, section: &'static str) {
        if !self.details.remove(&(id, section)) {
            self.details.insert((id, section));
        }
    }
    fn collapse_all(&mut self) {
        self.close_color();
        let all_closed = self
            .cards
            .iter()
            .all(|card| self.collapsed.contains(&card.id));
        if all_closed {
            for card in &self.cards {
                self.collapsed.remove(&card.id);
            }
        } else {
            self.collapsed.extend(self.cards.iter().map(|card| card.id));
        }
    }
    fn select(&mut self, id: u64) {
        if id != 0 {
            self.active = Some(id);
        }
        self.selected = Some(id);
        let cached = self.cards.iter().position(|c| c.id == id).is_some_and(|i| {
            self.outputs.get(i).is_some()
                && (!self.cards[i].enabled
                    || !self.cards[i].operation.has_preview_handles()
                    || i == 0
                    || self.outputs.get(i - 1).is_some())
        });
        if id == 0 || cached {
            self.refresh();
        } else if !self.worker.is_io() {
            self.process();
        }
    }
    fn toggle(&mut self, id: u64) {
        if !self.editable() {
            return;
        }
        let before = self.snapshot();
        if let Some(card) = self.cards.iter_mut().find(|c| c.id == id) {
            card.enabled = !card.enabled;
            let label = format!(
                "{} {}",
                if card.enabled { "Enable" } else { "Bypass" },
                card.operation.name()
            );
            self.active = Some(id);
            self.commit_edit(before, label, None);
        }
    }
    fn remove(&mut self, id: u64) {
        self.remove_named(id, "Delete");
    }
    fn remove_named(&mut self, id: u64, action: &str) {
        if !self.editable() {
            return;
        }
        let Some(card) = self.cards.iter().find(|card| card.id == id) else {
            return;
        };
        let label = format!("{action} {}", card.operation.name());
        let before = self.snapshot();
        self.close_color();
        self.cards.retain(|c| c.id != id);
        self.fields.remove(&id);
        self.pending_fields.retain(|(card, _), _| *card != id);
        self.font_pickers.remove(&id);
        self.font_visible.remove(&id);
        self.font_styles.remove(&id);
        self.local_edits.retain(|(card, _)| *card != id);
        self.collapsed.remove(&id);
        self.details.retain(|(card, _)| *card != id);
        if self.selected == Some(id) {
            self.selected = None;
        }
        if self.active == Some(id) {
            self.active = self.cards.last().map(|card| card.id);
        }
        self.commit_edit(before, label, None);
    }
    fn move_card(&mut self, from: usize, to: usize) {
        if !self.editable() || from >= self.cards.len() || to >= self.cards.len() || from == to {
            return;
        }
        let before = self.snapshot();
        let card = self.cards.remove(from);
        let label = format!("Reorder {}", card.operation.name());
        self.active = Some(card.id);
        self.cards.insert(to, card);
        self.commit_edit(before, label, None);
    }
    fn seek(&mut self, index: usize) {
        if self.placement.is_some() || self.spatial.is_some() {
            return;
        }
        self.playing = false;
        self.frame = index;
        self.elapsed = 0.;
        self.upload();
    }
    fn add_named(&mut self, kind: &str) {
        if let Some(operation) = Operation::catalog().into_iter().find(|op| op.id() == kind) {
            let Some(input) = self.final_output().or_else(|| self.source.clone()) else {
                return;
            };
            self.add(operation.defaults_for(&input));
        }
    }
    fn choose_file(&mut self, id: u64, index: usize, tx: &mut Tx) {
        if self.worker.is_io() {
            return;
        }
        tx.open_file(
            rune::FileDialogOptions {
                title: "Choose overlay image".into(),
                ..Default::default()
            }
            .filter("Images", &["png", "jpg", "jpeg", "gif"]),
            move |s: &mut State, result, _| match result {
                Ok(Some(path)) => {
                    if let Some(field) = s
                        .fields
                        .get_mut(&id)
                        .and_then(|fields| fields.get_mut(index))
                    {
                        *field = TextEdit::new(path.to_string_lossy().into_owned());
                        s.apply_parameters(id, &[index]);
                    }
                }
                Ok(None) => {}
                Err(error) => s.status = format!("Error: {error}"),
            },
        );
    }
    fn ready(&self) -> bool {
        self.pending_fields.is_empty()
            && !self.worker.busy()
            && self.source.as_ref().is_some_and(|source| {
                self.cards.is_empty() || self.outputs.matches(source, &self.cards)
            })
    }
    fn final_output(&self) -> Option<Arc<Animation>> {
        if self.cards.is_empty() {
            self.source.clone()
        } else {
            self.outputs.last().cloned()
        }
    }
}
fn preview_rgba(image: &image::RgbaImage) -> Vec<u8> {
    let mut rgba = image.as_raw().clone();
    for (index, pixel) in rgba.as_chunks_mut::<4>().0.iter_mut().enumerate() {
        if pixel[3] == 255 {
            continue;
        }
        let x = index as u32 % image.width();
        let y = index as u32 / image.width();
        let background = if (x / 12 + y / 12).is_multiple_of(2) {
            248u32
        } else {
            236u32
        };
        let alpha = pixel[3] as u32;
        for channel in &mut pixel[..3] {
            *channel = ((*channel as u32 * alpha + background * (255 - alpha) + 127) / 255) as u8;
        }
        pixel[3] = 255;
    }
    rgba
}

fn setup(s: &mut State, waker: Waker) {
    s.waker = Some(waker.clone());
    std::thread::spawn(move || {
        img::fonts::load_system_fonts();
        waker();
    });
    if let Some(path) = rune::extra_args().first() {
        s.request_io(worker::IoJob::Load(PathBuf::from(path)));
    }
}
fn poll(s: &mut State, now: f64, tx: &mut Tx) -> bool {
    let mut changed = s.poll_color();
    changed |= s.poll_fields(now, tx);
    if let Some(id) = s
        .cards
        .iter()
        .find(|card| {
            s.fields
                .get(&card.id)
                .is_some_and(|fields| fields.iter().any(|field| field.focused))
        })
        .map(|card| card.id)
        && s.active != Some(id)
    {
        s.active = Some(id);
        changed = true;
    }
    let fonts_ready = img::fonts::choices().is_some();
    if fonts_ready != s.fonts_ready {
        s.fonts_ready = fonts_ready;
        changed = true;
    }
    if let Some((result, next)) = s.worker.poll() {
        let rerender = matches!(
            next,
            Some(worker::Next::Render | worker::Next::RenderThenIo(_))
        );
        s.status.clear();
        match result {
            Ok(Completed::Loaded(source, name)) => {
                let before = s.source.as_ref().map(|_| s.snapshot());
                s.source = Some(source);
                s.frame = 0;
                s.name = name;
                s.outputs = Default::default();
                if let Some(before) = before {
                    s.commit_edit(before, "Replace GIF", None);
                } else {
                    s.cards.clear();
                    s.history = Default::default();
                    s.clipboard_assets = Default::default();
                    s.local_edits.clear();
                    s.active = None;
                    s.outputs = Default::default();
                    s.fields.clear();
                    s.font_pickers.clear();
                    s.font_visible.clear();
                    s.font_styles.clear();
                    s.collapsed.clear();
                    s.details.clear();
                    s.selected = None;
                    s.refresh();
                }
            }
            Ok(Completed::Processed(outputs)) => {
                s.outputs = outputs;
                if !rerender {
                    s.finish_placement();
                    s.finish_spatial();
                    s.refresh();
                }
            }
            Ok(Completed::Saved(path)) => s.status = format!("Saved {}", path.display()),
            Err(error) => {
                s.finish_placement();
                s.finish_spatial();
                s.upload();
                s.status = format!("Error: {error}");
            }
        }
        match next {
            Some(worker::Next::Render) => s.process(),
            Some(worker::Next::Io(job)) => s.request_io(job),
            Some(worker::Next::RenderThenIo(job)) => {
                s.process();
                s.request_io(job);
            }
            None => {}
        }
        changed = true;
        tx.animated();
    }
    let dt = s.clock.replace(now).map_or(0., |last| (now - last).max(0.));
    changed |= s.drag_frame(tx);
    if s.playing
        && let Some(animation) = &s.displayed
        && animation.frames.len() > 1
    {
        let cycle: f64 = animation
            .frames
            .iter()
            .map(|f| f.delay_ms.max(20) as f64 / 1000.)
            .sum();
        s.elapsed = (s.elapsed + dt) % cycle;
        let mut moved = false;
        while s.elapsed >= animation.frames[s.frame].delay_ms.max(20) as f64 / 1000. {
            s.elapsed -= animation.frames[s.frame].delay_ms.max(20) as f64 / 1000.;
            s.frame = (s.frame + 1) % animation.frames.len();
            moved = true;
        }
        if moved {
            s.upload();
            changed = true;
        }
        tx.wake_after(Duration::from_millis(16));
    }
    changed
}

mod clipboard;
mod drag;
mod editing;
mod field_edits;
mod font_preview;
mod history;
mod icons;
mod scenes;
mod system_color;
mod view;
mod worker;
use drag::DragState;

fn on_key(s: &mut State, event: &KeyEvent, tx: &mut Tx) -> bool {
    if event.key == Key::Escape && s.spatial.as_ref().is_some_and(|gesture| !gesture.committed) {
        s.cancel_spatial();
        return true;
    }
    if s.number.is_some() && event.key == Key::Escape {
        s.cancel_number();
        return true;
    }
    if s.color.draft.is_some() && !matches!(event.key, Key::Command('q' | 'w')) {
        if event.key == Key::Escape {
            if let Some(d) = &mut s.color.draft
                && matches!(d.mode, view::color::Mode::Sampling(None))
            {
                d.mode = view::color::Mode::Panel;
            } else {
                s.close_color();
            }
            return true;
        }
        return false;
    }
    if s.editing_key(event, tx) {
        return true;
    }
    if event.key == Key::Escape && s.placement.as_ref().is_some_and(|d| !d.committed) {
        s.cancel_placement();
        return true;
    }
    let field_focused = tx.focused().is_some_and(|key| {
        key.starts_with("number-scrub-")
            || key.starts_with("operation-menu")
            || key.starts_with("font-menu-")
            || key.starts_with("font-style-menu-")
            || s.cards.iter().any(|card| {
                card.operation
                    .parameters()
                    .iter()
                    .any(|p| key == format!("{}-{}", p.key, card.id))
            })
    });
    let frame_focused = tx.focused().is_some_and(|key| {
        key.starts_with("frame-") || matches!(key, "previous" | "next" | "play" | "frames")
    });
    if matches!(event.key, Key::Left | Key::Right | Key::Up | Key::Down)
        && !field_focused
        && !frame_focused
    {
        let step = if event.mods.shift { 10 } else { 1 };
        let (dx, dy) = match event.key {
            Key::Left => (-step, 0),
            Key::Right => (step, 0),
            Key::Up => (0, -step),
            _ => (0, step),
        };
        if s.nudge_text(dx, dy) {
            return true;
        }
    }
    match event.key {
        Key::Command('q') => tx.quit(),
        Key::Command('w') => tx.close_window(),
        Key::Command('o') if !s.worker.busy() => view::open(s, tx),
        Key::Left | Key::Right if !field_focused => {
            if let Some(animation) = &s.displayed {
                let frame = if event.key == Key::Left {
                    s.frame.saturating_sub(1)
                } else {
                    (s.frame + 1).min(animation.frames.len() - 1)
                };
                s.seek(frame);
            }
        }
        Key::Text(ref text) if text == " " && tx.focused().is_none() => s.playing = !s.playing,
        _ => return false,
    }
    true
}
pub fn run() -> anyhow::Result<()> {
    rune::set_app_icon(include_bytes!("../assets/icon.png").to_vec())
        .map_err(anyhow::Error::msg)?;
    let mut app = rune::App::new(AppSpec {
        fonts: font_preview::FONTS,
        setup: Some(setup),
        poll: Some(poll),
        on_key: Some(on_key),
        scenes: scenes::ALL,
        min_size: Some((700., 400.)),
        ..AppSpec::new("img", (980., 820.), State::empty, view::view)
    })
    .chrome(rune::Chrome {
        full_size_content: false,
        ..rune::Chrome::DEFAULT
    });
    for item in editing::native_items() {
        app = app.menu_item(item);
    }
    app.run();
    Ok(())
}
#[cfg(test)]
#[path = "ui/editing_tests.rs"]
mod editing_tests;
#[cfg(test)]
mod tests;
