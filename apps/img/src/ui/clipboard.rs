use super::*;
use anyhow::{Context, Result, bail, ensure};
use rune::{ClipboardContent, ClipboardImage};
#[path = "clipboard_format.rs"]
mod format;
pub(super) fn operation_transfer(text: &str) -> bool {
    text.trim_start().starts_with('{') && text.contains("\"img.operations\"")
}
pub(super) fn encode(cards: &[Card]) -> Result<String> {
    format::encode(cards)
}
#[cfg(test)]
pub(super) fn decode(text: &str) -> Result<Vec<(Operation, bool)>> {
    Ok(format::decode(text)?
        .into_iter()
        .map(|step| (step.operation, step.enabled))
        .collect())
}

#[derive(Default)]
pub(super) struct Assets {
    directory: Option<tempfile::TempDir>,
    next: u64,
}
impl Assets {
    fn image(&mut self, png: &[u8]) -> Result<String> {
        self.write(png, "png")
    }
    fn write(&mut self, data: &[u8], extension: &str) -> Result<String> {
        if self.directory.is_none() {
            self.directory = Some(tempfile::tempdir()?);
        }
        let stored =
            std::fs::read_dir(self.directory.as_ref().expect("Clipboard directory").path())?
                .filter_map(Result::ok)
                .filter_map(|entry| entry.metadata().ok())
                .map(|metadata| metadata.len())
                .sum::<u64>();
        ensure!(
            stored + data.len() as u64 <= 256 * 1024 * 1024,
            "Clipboard images exceed this document’s 256 MiB asset budget"
        );
        let path = self
            .directory
            .as_ref()
            .expect("Clipboard asset directory")
            .path()
            .join(format!("paste-{}.{extension}", self.next));
        self.next += 1;
        std::fs::write(&path, data)?;
        Ok(path.to_string_lossy().into_owned())
    }
}
impl State {
    pub(super) fn prune_clipboard_assets(&mut self) {
        let mut keep = self.history.asset_paths();
        for card in &self.cards {
            if let Operation::Overlay { path, .. } = &card.operation {
                keep.insert(path.clone());
            }
        }
        if let Some(directory) = &self.clipboard_assets.directory
            && let Ok(entries) = std::fs::read_dir(directory.path())
        {
            for entry in entries.flatten() {
                if !keep.contains(entry.path().to_string_lossy().as_ref()) {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
    }
    pub(super) fn active_card(&self) -> Option<&Card> {
        self.active
            .or(self.selected)
            .and_then(|id| self.cards.iter().find(|card| card.id == id))
            .or_else(|| self.cards.last())
    }
    pub(super) fn copy_operations(&mut self, all: bool, cut: bool, tx: &mut Tx) {
        let cards = if all {
            self.cards.clone()
        } else {
            self.active_card().cloned().into_iter().collect()
        };
        if cards.is_empty() {
            return;
        }
        if cut && !self.editable() {
            return;
        }
        match encode(&cards) {
            Ok(text) => {
                tx.copy(text);
                if cut {
                    if all {
                        let before = self.snapshot();
                        self.cards.clear();
                        self.selected = None;
                        self.active = None;
                        self.rebuild_fields();
                        self.commit_edit(before, "Cut operations", None);
                    } else {
                        self.remove_named(cards[0].id, "Cut");
                    }
                }
                self.status = format!(
                    "{} {} operation{}",
                    if cut { "Cut" } else { "Copied" },
                    cards.len(),
                    if cards.len() == 1 { "" } else { "s" }
                );
            }
            Err(error) => self.status = format!("Error: {error:#}"),
        }
    }
    pub(super) fn paste_clipboard(&mut self, tx: &mut Tx) {
        let source = self.source.clone();
        tx.read_clipboard(move |s: &mut State, content, _| {
            let same = match (&source, &s.source) {
                (Some(a), Some(b)) => Arc::ptr_eq(a, b),
                (None, None) => true,
                _ => false,
            };
            if same {
                s.paste_content(content);
            }
        });
    }
    pub(super) fn paste_content(&mut self, content: &ClipboardContent) {
        if self.worker.is_io() {
            return;
        }
        let result = (|| -> Result<()> {
            ensure!(
                self.source.is_none() || self.cards.len() < img::MAX_OPERATIONS,
                "The stack can contain at most {} operations",
                img::MAX_OPERATIONS
            );
            if let Some(image) = content.image() {
                return self.paste_image(image);
            }
            if let Some(path) = content.files().first() {
                ensure!(
                    content.files().len() == 1,
                    "Paste one image or GIF at a time"
                );
                if self.source.is_none() {
                    self.request_io(worker::IoJob::Load(path.clone()));
                    return Ok(());
                }
                self.prune_clipboard_assets();
                use std::io::Read;
                let mut data = vec![];
                std::fs::File::open(path)?
                    .take(64 * 1024 * 1024 + 1)
                    .read_to_end(&mut data)?;
                ensure!(data.len() <= 64 * 1024 * 1024, "Pasted file exceeds 64 MiB");
                let extension = match image::guess_format(&data)? {
                    image::ImageFormat::Png => "png",
                    image::ImageFormat::Gif => "gif",
                    image::ImageFormat::Jpeg => "jpg",
                    _ => bail!("Paste a GIF, PNG, or JPEG"),
                };
                let path = self.clipboard_assets.write(&data, extension)?;
                let op = Operation::Overlay {
                    path,
                    x: 0,
                    y: 0,
                    width: 0,
                    percent: 100.,
                };
                self.insert_operations(vec![(op, true)], "Paste image");
                return Ok(());
            }
            if content.text().is_empty() {
                bail!("The clipboard is empty");
            }
            if !operation_transfer(content.text()) {
                let input = self
                    .final_output()
                    .or_else(|| self.source.clone())
                    .context("Open a GIF before pasting a caption")?;
                let operation = Operation::catalog()
                    .into_iter()
                    .find(|op| matches!(op, Operation::Text { .. }))
                    .expect("Text operation")
                    .defaults_for(&input);
                let mut values: Vec<_> = operation
                    .parameters()
                    .into_iter()
                    .map(|p| p.value)
                    .collect();
                values[0] = content.text().into();
                let operation = operation.with_parameters(&values)?;
                self.insert_operations(vec![(operation, true)], "Paste text");
                return Ok(());
            }
            let mut decoded = format::decode(content.text())?;
            ensure!(
                self.source.is_some(),
                "Import a GIF before pasting operations"
            );
            ensure!(
                self.cards.len() + decoded.len() <= img::MAX_OPERATIONS,
                "The stack can contain at most {} operations",
                img::MAX_OPERATIONS
            );
            self.prune_clipboard_assets();
            for step in &mut decoded {
                if let Some((extension, bytes)) = &step.asset {
                    let stored = self.clipboard_assets.write(bytes, extension)?;
                    if let Operation::Overlay { path, .. } = &mut step.operation {
                        *path = stored;
                    }
                }
            }
            let operations = decoded
                .into_iter()
                .map(|step| (step.operation, step.enabled))
                .collect();
            self.insert_operations(operations, "Paste operations");
            Ok(())
        })();
        if let Err(error) = result {
            self.prune_clipboard_assets();
            self.status = format!("Error: {error:#}");
        }
    }
    fn paste_image(&mut self, image: &ClipboardImage) -> Result<()> {
        let (width, height) = image.size();
        ensure!(
            width <= img::MAX_DIMENSION && height <= img::MAX_DIMENSION,
            "Pasted image exceeds {} pixels per side",
            img::MAX_DIMENSION
        );
        let mut reader =
            image::ImageReader::new(std::io::Cursor::new(image.png())).with_guessed_format()?;
        let mut limits = image::Limits::default();
        limits.max_image_width = Some(img::MAX_DIMENSION);
        limits.max_image_height = Some(img::MAX_DIMENSION);
        limits.max_alloc = Some(img::MAX_BYTES as u64);
        reader.limits(limits);
        let pixels = reader.decode()?.to_rgba8();
        if self.source.is_none() {
            let before = self.snapshot();
            let source = Animation {
                frames: vec![img::Frame {
                    pixels: pixels.into(),
                    delay_ms: 100,
                }],
                repeat: gif::Repeat::Infinite,
            };
            source.validate()?;
            self.source = Some(Arc::new(source));
            self.name = "Clipboard image".into();
            self.cards.clear();
            self.rebuild_fields();
            self.selected = None;
            self.active = None;
            self.frame = 0;
            self.refresh();
            self.commit_edit(before, "Paste image", None);
        } else {
            ensure!(self.cards.len() < img::MAX_OPERATIONS, "The stack is full");
            let path = self.clipboard_assets.image(image.png())?;
            self.insert_operations(
                vec![(
                    Operation::Overlay {
                        path,
                        x: 0,
                        y: 0,
                        width: 0,
                        percent: 100.,
                    },
                    true,
                )],
                "Paste image",
            );
        }
        Ok(())
    }
    pub(super) fn insert_operations(&mut self, operations: Vec<(Operation, bool)>, label: &str) {
        if !self.editable()
            || operations.is_empty()
            || self.cards.len() + operations.len() > img::MAX_OPERATIONS
        {
            return;
        }
        self.close_color();
        self.cancel_placement();
        self.dragging = None;
        let before = self.snapshot();
        let at = self
            .active_card()
            .and_then(|active| self.cards.iter().position(|card| card.id == active.id))
            .map_or(self.cards.len(), |index| index + 1);
        self.collapsed.extend(self.cards.iter().map(|card| card.id));
        let mut inserted = vec![];
        for (operation, enabled) in operations {
            let id = self.next_id;
            self.next_id += 1;
            inserted.push(Card {
                id,
                operation,
                enabled,
            });
            self.active = Some(id);
        }
        for card in &inserted {
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
        self.cards.splice(at..at, inserted);
        self.selected = self.active;
        self.commit_edit(before, label, None);
    }
    pub(super) fn duplicate(&mut self) {
        if let Some(card) = self.active_card().cloned() {
            self.insert_operations(vec![(card.operation, card.enabled)], "Duplicate operation");
        }
    }
    pub(super) fn copy_frame(&mut self, tx: &mut Tx) {
        let Some(animation) = &self.displayed else {
            return;
        };
        let frame = &animation.frames[self.frame];
        let result = (|| -> Result<ClipboardImage> {
            let mut png = std::io::Cursor::new(vec![]);
            image::DynamicImage::ImageRgba8(frame.pixels.as_ref().clone())
                .write_to(&mut png, image::ImageFormat::Png)?;
            ClipboardImage::from_png(png.into_inner())
                .context("Frame exceeds the clipboard image limit")
        })();
        match result {
            Ok(image) => {
                tx.copy_rich(ClipboardContent::default().with_image(image));
                self.status = "Copied frame".into();
            }
            Err(error) => self.status = format!("Error: {error:#}"),
        }
    }
}
