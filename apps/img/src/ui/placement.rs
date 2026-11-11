use super::*;
use rune::{Drag, Phase};

pub(crate) struct Gesture {
    id: u64,
    original: Operation,
    pub current: Operation,
    original_bounds: [i32; 4],
    sprite: Option<TextSprite>,
    canvas: (u32, u32),
    scale: f32,
    pub committed: bool,
    resume: bool,
    snap: [Option<i32>; 2],
}
fn coordinates(op: &Operation) -> (i32, i32, u32) {
    match *op {
        Operation::Text { x, y, size, .. } => (x, y, size),
        _ => unreachable!("Text placement"),
    }
}
fn position(op: &mut Operation, left: i32, top: i32) {
    if let Operation::Text { x, y, .. } = op {
        *x = left.clamp(-4096, 4096);
        *y = top.clamp(-4096, 4096);
    }
}
struct TextSprite {
    pixels: Pixels,
    bounds: [i32; 4],
}
fn sprite(op: &Operation, (w, h): (u32, u32)) -> anyhow::Result<Option<TextSprite>> {
    let Some([left, top, width, height]) = op.text_bounds() else {
        return Ok(None);
    };
    let x0 = left.clamp(0, w as i32);
    let y0 = top.clamp(0, h as i32);
    let x1 = (left + width).clamp(0, w as i32);
    let y1 = (top + height).clamp(0, h as i32);
    if x0 >= x1 || y0 >= y1 {
        return Ok(None);
    }
    let (width, height) = ((x1 - x0) as u32, (y1 - y0) as u32);
    let mut local = op.clone();
    let (x, y, _) = coordinates(op);
    position(&mut local, x - x0, y - y0);
    let blank = Arc::new(Animation {
        frames: vec![img::Frame {
            pixels: image::RgbaImage::new(width, height).into(),
            delay_ms: 10,
        }],
        repeat: gif::Repeat::Infinite,
    });
    let result = img::process(
        blank,
        &[Card {
            id: 0,
            enabled: true,
            operation: local,
        }],
    )?;
    let pixels = Pixels::new();
    pixels.set(width, height, result[0].frames[0].pixels.as_raw().clone());
    Ok(Some(TextSprite {
        pixels,
        bounds: [x0, y0, width as i32, height as i32],
    }))
}

impl State {
    fn text_context(&self) -> Option<(u64, Operation, Arc<Animation>)> {
        if !self.ready() {
            return None;
        }
        let id = self
            .selected
            .unwrap_or_else(|| self.cards.last().map_or(0, |c| c.id));
        let index = self.cards.iter().position(|c| c.id == id)?;
        let card = &self.cards[index];
        if !card.enabled || !matches!(card.operation, Operation::Text { .. }) {
            return None;
        }
        let base = if index == 0 {
            self.source.clone()?
        } else {
            self.outputs.get(index - 1)?.clone()
        };
        Some((id, card.operation.clone(), base))
    }
    fn sync_placement_fields(&mut self, id: u64, op: &Operation) {
        let (x, y, size) = coordinates(op);
        if let Some(fields) = self.fields.get_mut(&id) {
            for (index, value) in [
                (1, x.to_string()),
                (2, y.to_string()),
                (3, size.to_string()),
            ] {
                fields[index] = TextEdit::new(value);
            }
        }
    }
    pub(crate) fn finish_placement(&mut self) {
        if let Some(drag) = self.placement.take() {
            self.playing = drag.resume;
            self.clock = None;
        }
    }
    pub(crate) fn cancel_placement(&mut self) {
        if self.placement.as_ref().is_some_and(|d| d.committed) {
            return;
        }
        if let Some(drag) = self.placement.take() {
            self.sync_placement_fields(drag.id, &drag.original);
            self.playing = drag.resume;
            self.clock = None;
            self.upload();
        }
    }
    fn drag_text(&mut self, d: &Drag, resize: bool, scale: f32) {
        if d.cancelled() {
            self.cancel_placement();
            return;
        }
        match d.phase {
            Phase::Down => {
                if self.placement.is_some() {
                    return;
                }
                let Some((id, operation, base)) = self.text_context() else {
                    return;
                };
                match sprite(&operation, base.frames[0].pixels.dimensions()) {
                    Ok(sprite) => {
                        let Some(bounds) = operation.text_bounds() else {
                            return;
                        };
                        self.close_color();
                        let frame = &base.frames[self.frame.min(base.frames.len() - 1)];
                        self.pixels.set(
                            frame.pixels.width(),
                            frame.pixels.height(),
                            preview_rgba(&frame.pixels),
                        );
                        self.placement = Some(Gesture {
                            id,
                            original: operation.clone(),
                            current: operation,
                            original_bounds: bounds,
                            sprite,
                            canvas: base.frames[0].pixels.dimensions(),
                            scale,
                            committed: false,
                            resume: self.playing,
                            snap: [None; 2],
                        });
                        self.playing = false;
                    }
                    Err(error) => self.status = error.to_string(),
                }
            }
            Phase::Move => {
                let Some(drag) = &mut self.placement else {
                    return;
                };
                if drag.committed {
                    return;
                }
                let (x, y, size) = coordinates(&drag.original);
                let mut operation = drag.original.clone();
                if resize {
                    let ratio = (1. + d.dx / (drag.original_bounds[2] as f32 * drag.scale).max(1.))
                        .max(0.05);
                    if let Operation::Text { size: new_size, .. } = &mut operation {
                        *new_size = (size as f32 * ratio).round().clamp(8., 256.) as u32;
                    }
                    let Some(bounds) = operation.text_bounds() else {
                        return;
                    };
                    position(
                        &mut operation,
                        x + drag.original_bounds[0] - bounds[0],
                        y + drag.original_bounds[1] - bounds[1],
                    );
                    match sprite(&operation, drag.canvas) {
                        Ok(sprite) => {
                            drag.sprite = sprite;
                            drag.current = operation;
                        }
                        Err(error) => {
                            self.status = error.to_string();
                            return;
                        }
                    }
                } else {
                    let px = x + (d.dx / drag.scale).round() as i32;
                    let py = y + (d.dy / drag.scale).round() as i32;
                    position(&mut operation, px, py);
                    let Some(bounds) = operation.text_bounds() else {
                        return;
                    };
                    let Some(displayed) = &self.displayed else {
                        return;
                    };
                    let (w, h) = displayed.frames[0].pixels.dimensions();
                    let tolerance = (6. / drag.scale).max(1.);
                    let mut point = [bounds[0], bounds[1]];
                    let sizes = [w as i32, h as i32];
                    for axis in 0..2 {
                        let length = bounds[axis + 2];
                        let margin = 8.min(sizes[axis] / 4);
                        let targets = [
                            margin,
                            (sizes[axis] - length) / 2,
                            sizes[axis] - length - margin,
                        ];
                        let (target_index, nearest) = targets
                            .into_iter()
                            .enumerate()
                            .min_by_key(|(_, target)| (point[axis] - target).abs())
                            .expect("Alignment targets");
                        drag.snap[axis] = if (point[axis] - nearest).abs() as f32 <= tolerance {
                            point[axis] = nearest;
                            Some([margin, sizes[axis] / 2, sizes[axis] - margin][target_index])
                        } else {
                            None
                        };
                    }
                    position(
                        &mut operation,
                        px + point[0] - bounds[0],
                        py + point[1] - bounds[1],
                    );

                    match sprite(&operation, drag.canvas) {
                        Ok(sprite) => {
                            drag.sprite = sprite;
                            drag.current = operation;
                        }
                        Err(error) => {
                            self.status = error.to_string();
                            return;
                        }
                    }
                }
                let id = drag.id;
                let operation = drag.current.clone();
                self.sync_placement_fields(id, &operation);
            }
            Phase::Up => {
                let Some(drag) = &mut self.placement else {
                    return;
                };
                if drag.committed {
                    return;
                }
                if drag.current == drag.original {
                    self.cancel_placement();
                    return;
                }
                let id = drag.id;
                let operation = drag.current.clone();
                drag.committed = true;
                self.edit_operation(
                    id,
                    operation,
                    if resize { "Resize text" } else { "Move text" },
                    None,
                );
            }
        }
    }
    pub(crate) fn align_text(&mut self, id: u64, horizontal: usize, vertical: usize) {
        let Some((selected, mut operation, base)) = self.text_context() else {
            return;
        };
        if selected != id || self.placement.is_some() {
            return;
        }
        let Some(bounds) = operation.text_bounds() else {
            return;
        };
        let (w, h) = base.frames[0].pixels.dimensions();
        let margin = 8.min(w.min(h) as i32 / 4);
        let left = [
            margin,
            (w as i32 - bounds[2]) / 2,
            w as i32 - bounds[2] - margin,
        ][horizontal];
        let top = [
            margin,
            (h as i32 - bounds[3]) / 2,
            h as i32 - bounds[3] - margin,
        ][vertical];
        let (x, y, _) = coordinates(&operation);
        position(&mut operation, x + left - bounds[0], y + top - bounds[1]);
        self.sync_placement_fields(id, &operation);
        self.edit_operation(id, operation, "Align text", None);
    }
    pub(crate) fn nudge_text(&mut self, dx: i32, dy: i32) -> bool {
        if self.placement.is_some() || self.worker.is_io() {
            return false;
        }
        let id = self
            .selected
            .unwrap_or_else(|| self.cards.last().map_or(0, |c| c.id));
        let Some(card) = self
            .cards
            .iter()
            .find(|c| c.id == id && c.enabled && matches!(c.operation, Operation::Text { .. }))
        else {
            return false;
        };
        let mut operation = card.operation.clone();
        let (x, y, _) = coordinates(&operation);
        position(&mut operation, x + dx, y + dy);
        self.sync_placement_fields(id, &operation);
        self.edit_operation(id, operation, "Move text", Some(id));
        true
    }
}

pub(super) fn image(s: &State, image: El, size: [f32; 2]) -> El {
    if s.color.draft.is_some() && s.placement.is_none() {
        return image;
    }
    let (operation, sprite, snap, committed) = if let Some(d) = &s.placement {
        (&d.current, d.sprite.as_ref(), d.snap, d.committed)
    } else {
        let Some((_, operation, _)) = s.text_context() else {
            return image;
        };
        return overlay(s, image, size, &operation, None, [None; 2], false);
    };
    overlay(s, image, size, operation, sprite, snap, committed)
}
fn overlay(
    s: &State,
    image: El,
    size: [f32; 2],
    operation: &Operation,
    sprite: Option<&TextSprite>,
    snap: [Option<i32>; 2],
    committed: bool,
) -> El {
    let Some(animation) = &s.displayed else {
        return image;
    };
    let (w, h) = animation.frames[0].pixels.dimensions();
    let Some([left, top, bw, bh]) = operation.text_bounds() else {
        return image;
    };
    let scale = if s.actual_size {
        1.
    } else {
        (size[0] / w as f32).min(size[1] / h as f32)
    };
    if scale <= 0. {
        return image;
    }
    let ox = if s.actual_size {
        0.
    } else {
        (size[0] - w as f32 * scale) / 2.
    };
    let oy = if s.actual_size {
        0.
    } else {
        (size[1] - h as f32 * scale) / 2.
    };
    let mut layer = el()
        .key("placement-canvas")
        .absolute(ox, oy)
        .size(w as f32 * scale, h as f32 * scale)
        .clip_rounded(0.);
    if let Some(x) = snap[0] {
        layer = layer.child(
            el().key("snap-guide-x")
                .absolute(x as f32 * scale, 0.)
                .size(2., h as f32 * scale)
                .fill(Color::WHITE)
                .child(el().w(1.).h_full().fill(ink()))
                .inert(),
        );
    }
    if let Some(y) = snap[1] {
        layer = layer.child(
            el().key("snap-guide-y")
                .absolute(0., y as f32 * scale)
                .size(w as f32 * scale, 2.)
                .fill(Color::WHITE)
                .child(el().w_full().h(1.).fill(ink()))
                .inert(),
        );
    }
    let mut selection = el()
        .key("text-selection")
        .absolute(left as f32 * scale, top as f32 * scale)
        .size(bw as f32 * scale, bh as f32 * scale)
        .border(1., ink())
        .focusable(true)
        .role("button")
        .label("Move text")
        .help("Drag to move text. Arrow keys nudge; Shift moves 10 pixels. Escape cancels.")
        .cursor(rune::Cursor::Move)
        .instant_changes()
        .on_drag(move |s: &mut State, drag, tx| {
            s.drag_text(drag, false, scale);
            tx.instant();
        });
    if let Some(sprite) = sprite {
        selection = selection.child(
            el().absolute(
                (sprite.bounds[0] - left) as f32 * scale,
                (sprite.bounds[1] - top) as f32 * scale,
            )
            .size(
                sprite.bounds[2] as f32 * scale,
                sprite.bounds[3] as f32 * scale,
            )
            .pixels(&sprite.pixels)
            .inert(),
        );
    }
    for (x, y) in [(0., 0.), (1., 0.), (0., 1.)] {
        selection = selection.child(
            el().absolute(x * bw as f32 * scale - 3., y * bh as f32 * scale - 3.)
                .size(6., 6.)
                .fill(Color::WHITE)
                .border(1., ink())
                .inert(),
        );
    }
    selection = selection.child(
        el().key("text-resize")
            .absolute(bw as f32 * scale - 5., bh as f32 * scale - 5.)
            .size(10., 10.)
            .fill(Color::WHITE)
            .border(1., ink())
            .cursor(rune::Cursor::ResizeColumn)
            .role("button")
            .label("Resize text")
            .help("Drag to change font size")
            .on_drag(move |s: &mut State, drag, tx| {
                s.drag_text(drag, true, scale);
                tx.instant();
            }),
    );
    image.child(layer.child(if committed {
        selection.disabled(true).inert()
    } else {
        selection
    }))
}
pub(super) fn alignment(s: &State, id: u64) -> El {
    let labels = [
        ["Top left", "Top center", "Top right"],
        ["Middle left", "Center", "Middle right"],
        ["Bottom left", "Bottom center", "Bottom right"],
    ];
    let enabled = s.placement.is_none()
        && s.text_context().is_some_and(|(selected, operation, _)| {
            selected == id && operation.text_bounds().is_some()
        });
    let mut grid = col().gap(2.).role("group").label("Align text in canvas");
    for (y, labels) in labels.into_iter().enumerate() {
        let mut line = row().gap(2.);
        for (x, name) in labels.into_iter().enumerate() {
            line = line.child(
                el().key(format!("align-{id}-{x}-{y}"))
                    .size(24., 22.)
                    .center()
                    .radius(2.)
                    .border(0.75, super::line())
                    .role("button")
                    .label(name)
                    .help(name)
                    .focusable(true)
                    .hover(rune::oklch(0.95, 0., 0.))
                    .on_press(move |s: &mut State| s.align_text(id, x, y))
                    .child(
                        el().size(12., 12.).border(0.75, super::line()).child(
                            el().absolute(x as f32 * 4., y as f32 * 4.)
                                .size(3., 3.)
                                .fill(ink()),
                        ),
                    )
                    .blocked(!enabled),
            );
        }
        grid = grid.child(line);
    }
    grid
}
