use super::*;
use rune::{Drag, Phase};

#[derive(Clone, Copy)]
enum Handle {
    Move,
    Resize,
    Rotate,
}
pub(crate) struct Gesture {
    id: u64,
    original: Operation,
    current: Operation,
    fields: Vec<TextEdit>,
    local: Vec<bool>,
    pixels: Pixels,
    base: [f32; 2],
    rect: [f32; 4],
    scale: f32,
    vector: [f32; 2],
    resume: bool,
    pub committed: bool,
}
fn dimensions(op: &Operation) -> Option<[f32; 2]> {
    match *op {
        Operation::Resize { width, height }
        | Operation::Fit { width, height }
        | Operation::Fill { width, height }
        | Operation::Canvas { width, height }
        | Operation::Crop { width, height, .. } => Some([width as f32, height as f32]),
        _ => None,
    }
}
fn rotated(point: [f32; 2], angle: f32) -> [f32; 2] {
    let (sin, cos) = angle.sin_cos();
    [
        point[0] * cos - point[1] * sin,
        point[0] * sin + point[1] * cos,
    ]
}
impl State {
    fn spatial_context(&self) -> Option<(u64, Operation, Arc<Animation>)> {
        if !self.ready() || self.color.draft.is_some() || self.placement.is_some() {
            return None;
        }
        let id = self
            .selected
            .unwrap_or_else(|| self.cards.last().map_or(0, |c| c.id));
        let index = self.cards.iter().position(|c| c.id == id)?;
        let card = &self.cards[index];
        if !card.enabled
            || !card.operation.has_preview_handles()
            || matches!(card.operation, Operation::Text { .. })
        {
            return None;
        }
        let base = if index == 0 {
            self.source.clone()?
        } else {
            self.outputs.get(index - 1)?.clone()
        };
        Some((id, card.operation.clone(), base))
    }
    pub(crate) fn finish_spatial(&mut self) {
        if let Some(gesture) = self.spatial.take() {
            self.playing = gesture.resume;
            self.clock = None;
        }
    }
    pub(crate) fn cancel_spatial(&mut self) {
        if let Some(gesture) = self.spatial.take() {
            if !gesture.committed {
                self.fields.insert(gesture.id, gesture.fields);
                self.local_edits.retain(|(id, _)| *id != gesture.id);
                self.local_edits.extend(
                    gesture
                        .local
                        .iter()
                        .enumerate()
                        .filter_map(|(index, dirty)| dirty.then_some((gesture.id, index))),
                );
            }
            self.playing = gesture.resume;
            self.clock = None;
        }
    }
    fn drag_spatial(
        &mut self,
        drag: &Drag,
        handle: Handle,
        rect: [f32; 4],
        scale: f32,
        handle_at: [f32; 2],
        tx: &mut Tx,
    ) {
        if drag.cancelled() {
            self.cancel_spatial();
            return;
        }
        match drag.phase {
            Phase::Down => {
                let Some((id, operation, base)) = self.spatial_context() else {
                    return;
                };
                let frame = &base.frames[self.frame.min(base.frames.len() - 1)];
                let pixels = Pixels::new();
                pixels.set(
                    frame.pixels.width(),
                    frame.pixels.height(),
                    preview_rgba(&frame.pixels),
                );
                let fields = self.fields.get(&id).cloned().unwrap_or_default();
                self.spatial = Some(Gesture {
                    id,
                    original: operation.clone(),
                    current: operation,
                    local: (0..fields.len())
                        .map(|index| self.local_edits.contains(&(id, index)))
                        .collect(),
                    fields,
                    pixels,
                    base: [frame.pixels.width() as f32, frame.pixels.height() as f32],
                    rect,
                    scale,
                    vector: [
                        handle_at[0] + drag.start_x - rect[0] - rect[2] / 2.,
                        handle_at[1] + drag.start_y - rect[1] - rect[3] / 2.,
                    ],
                    resume: self.playing,
                    committed: false,
                });
                self.active = Some(id);
                self.playing = false;
                tx.blur();
            }
            Phase::Move => {
                let Some(gesture) = &mut self.spatial else {
                    return;
                };
                if gesture.committed {
                    return;
                }
                let mut operation = gesture.original.clone();
                let dx = drag.dx / gesture.scale;
                let dy = drag.dy / gesture.scale;
                match (&mut operation, handle) {
                    (Operation::Rotate { degrees }, Handle::Rotate) => {
                        let start = gesture.vector[1].atan2(gesture.vector[0]);
                        let angle =
                            (gesture.vector[1] + drag.dy).atan2(gesture.vector[0] + drag.dx);
                        let delta = (angle - start + std::f32::consts::PI)
                            .rem_euclid(std::f32::consts::TAU)
                            - std::f32::consts::PI;
                        *degrees = (*degrees + delta.to_degrees()).clamp(-360., 360.);
                        if tx.mods().shift {
                            *degrees = (*degrees / 15.).round() * 15.;
                        } else {
                            *degrees = (*degrees * 10.).round() / 10.;
                        }
                    }
                    (Operation::Roll { x, y }, Handle::Move) => {
                        *x = (*x + dx.round() as i32).clamp(-4096, 4096);
                        *y = (*y + dy.round() as i32).clamp(-4096, 4096);
                    }
                    (
                        Operation::Crop {
                            x,
                            y,
                            width,
                            height,
                        },
                        Handle::Move,
                    ) => {
                        *x = (*x as f32 + dx)
                            .round()
                            .clamp(0., (gesture.base[0] - *width as f32).max(0.))
                            as u32;
                        *y = (*y as f32 + dy)
                            .round()
                            .clamp(0., (gesture.base[1] - *height as f32).max(0.))
                            as u32;
                    }
                    (
                        Operation::Resize { width, height }
                        | Operation::Fit { width, height }
                        | Operation::Fill { width, height }
                        | Operation::Canvas { width, height }
                        | Operation::Crop { width, height, .. },
                        Handle::Resize,
                    ) => {
                        let original = [*width as f32, *height as f32];
                        *width = (original[0] + dx).round().clamp(1., 4096.) as u32;
                        *height = (original[1] + dy).round().clamp(1., 4096.) as u32;
                        if tx.mods().shift {
                            *height = (*width as f32 * original[1] / original[0])
                                .round()
                                .clamp(1., 4096.) as u32;
                        }
                    }
                    _ => {}
                }
                if let Operation::Crop {
                    x,
                    y,
                    width,
                    height,
                } = &mut operation
                {
                    *width = (*width).min(gesture.base[0] as u32 - *x);
                    *height = (*height).min(gesture.base[1] as u32 - *y);
                }
                let previous = gesture.current.parameters();
                for (index, parameter) in operation.parameters().into_iter().enumerate() {
                    if parameter.value != previous[index].value {
                        if let Some(field) = self
                            .fields
                            .get_mut(&gesture.id)
                            .and_then(|fields| fields.get_mut(index))
                        {
                            *field = TextEdit::new(parameter.value);
                        }
                        self.local_edits.remove(&(gesture.id, index));
                        self.pending_fields.remove(&(gesture.id, index));
                    }
                }
                gesture.current = operation;
            }
            Phase::Up => {
                let Some(gesture) = &mut self.spatial else {
                    return;
                };
                if gesture.committed {
                    return;
                }
                if gesture.current == gesture.original {
                    self.finish_spatial();
                    return;
                }
                gesture.committed = true;
                let (id, operation) = (gesture.id, gesture.current.clone());
                self.edit_operation(id, operation, "Transform in preview", None);
            }
        }
        tx.instant();
    }
}
fn grip(key: &str, title: &str, at: [f32; 2], handle: Handle, rect: [f32; 4], scale: f32) -> El {
    el().key(key)
        .absolute(at[0], at[1])
        .size(14., 14.)
        .radius(if matches!(handle, Handle::Rotate) {
            7.
        } else {
            2.
        })
        .fill(Color::WHITE)
        .border(1., ink())
        .role("button")
        .label(title)
        .help("Drag to adjust. Shift snaps rotation or keeps proportions. Escape cancels.")
        .cursor(if matches!(handle, Handle::Rotate) {
            rune::Cursor::Crosshair
        } else {
            rune::Cursor::ResizeColumn
        })
        .on_drag(move |s: &mut State, drag, tx| s.drag_spatial(drag, handle, rect, scale, at, tx))
}
fn texture(pixels: &Pixels, at: [f32; 2], size: [f32; 2]) -> El {
    el().absolute(at[0], at[1])
        .size(size[0], size[1])
        .pixels(pixels)
        .inert()
}
pub(super) fn image(s: &State, image: El, size: [f32; 2]) -> El {
    let (operation, base) = if let Some(gesture) = &s.spatial {
        (gesture.current.clone(), gesture.base)
    } else if let Some((_, operation, base)) = s.spatial_context() {
        (
            operation,
            [
                base.frames[0].pixels.width() as f32,
                base.frames[0].pixels.height() as f32,
            ],
        )
    } else {
        return image;
    };
    let Some(animation) = &s.displayed else {
        return image;
    };
    let (w, h) = animation.frames[0].pixels.dimensions();
    let scale = s.spatial.as_ref().map_or_else(
        || {
            if s.actual_size {
                1.
            } else {
                (size[0] / w as f32).min(size[1] / h as f32)
            }
        },
        |g| g.scale,
    );
    if scale <= 0. {
        return image;
    }
    let mut rect = s.spatial.as_ref().map_or(
        [
            (size[0] - w as f32 * scale) / 2.,
            (size[1] - h as f32 * scale) / 2.,
            w as f32 * scale,
            h as f32 * scale,
        ],
        |g| g.rect,
    );
    if s.spatial.is_none() && matches!(operation, Operation::Fit { .. }) {
        let target = dimensions(&operation)
            .expect("Fit dimensions")
            .map(|n| n * scale);
        rect = [
            rect[0] + (rect[2] - target[0]) / 2.,
            rect[1] + (rect[3] - target[1]) / 2.,
            target[0],
            target[1],
        ];
    }
    let [x, y, width, height] = rect;
    let center = [x + width / 2., y + height / 2.];
    let mut layer = el()
        .key("spatial-controls")
        .absolute(0., 0.)
        .size(size[0], size[1])
        .instant_changes();
    let mut visible = image;
    if let Some(gesture) = &s.spatial {
        visible = visible.opacity(0.).inert();
        let [bw, bh] = base.map(|v| v * scale);
        let target = dimensions(&operation)
            .unwrap_or([w as f32, h as f32])
            .map(|v| v * scale);
        let mut preview = el()
            .absolute(x, y)
            .size(target[0], target[1])
            .clip_rounded(0.);
        match operation {
            Operation::Rotate { degrees } => {
                preview = el().absolute(0., 0.).size(size[0], size[1]).child(
                    texture(
                        &gesture.pixels,
                        [center[0] - bw / 2., center[1] - bh / 2.],
                        [bw, bh],
                    )
                    .rotate(degrees.to_radians()),
                );
            }
            Operation::Crop {
                x: left, y: top, ..
            } => {
                preview = preview.child(texture(
                    &gesture.pixels,
                    [-(left as f32) * scale, -(top as f32) * scale],
                    [bw, bh],
                ));
            }
            Operation::Canvas { .. } => {
                preview = preview.child(texture(
                    &gesture.pixels,
                    [(target[0] - bw) / 2., (target[1] - bh) / 2.],
                    [bw, bh],
                ));
            }
            Operation::Fit { .. } | Operation::Fill { .. } => {
                let factor = if matches!(operation, Operation::Fit { .. }) {
                    (target[0] / bw).min(target[1] / bh)
                } else {
                    (target[0] / bw).max(target[1] / bh)
                };
                preview = preview.child(texture(
                    &gesture.pixels,
                    [
                        (target[0] - bw * factor) / 2.,
                        (target[1] - bh * factor) / 2.,
                    ],
                    [bw * factor, bh * factor],
                ));
            }
            Operation::Roll { x: left, y: top } => {
                let offset = [
                    (left as f32 * scale).rem_euclid(bw),
                    (top as f32 * scale).rem_euclid(bh),
                ];
                for row in -1..=1 {
                    for col in -1..=1 {
                        preview = preview.child(texture(
                            &gesture.pixels,
                            [offset[0] + col as f32 * bw, offset[1] + row as f32 * bh],
                            [bw, bh],
                        ));
                    }
                }
            }
            _ => {
                preview = preview.child(texture(&gesture.pixels, [0., 0.], target));
            }
        }
        layer = layer.child(preview.inert());
    }
    let target = dimensions(&operation).map_or([width, height], |d| d.map(|n| n * scale));
    let mut outline = el()
        .key("spatial-selection")
        .absolute(x, y)
        .size(target[0], target[1])
        .border(1., ink());
    if matches!(operation, Operation::Crop { .. } | Operation::Roll { .. }) {
        outline = outline
            .role("button")
            .label("Move sampling area")
            .cursor(rune::Cursor::Move)
            .on_drag(move |s: &mut State, drag, tx| {
                s.drag_spatial(drag, Handle::Move, rect, scale, [x, y], tx)
            });
    } else {
        outline = outline.inert();
    }
    if let Operation::Rotate { degrees } = operation {
        let angle = degrees.to_radians();
        let bounds = [base[0] * scale, base[1] * scale];
        outline = el()
            .absolute(center[0] - bounds[0] / 2., center[1] - bounds[1] / 2.)
            .size(bounds[0], bounds[1])
            .border(1., ink())
            .rotate(angle)
            .inert();
        let stem = rotated([0., -bounds[1] / 2. - 10.], angle);
        layer = layer.child(
            el().absolute(center[0] + stem[0] - 0.5, center[1] + stem[1] - 10.)
                .size(1., 20.)
                .fill(ink())
                .rotate(angle)
                .inert(),
        );
        let point = rotated([0., -bounds[1] / 2. - 20.], angle);
        let at = [
            (center[0] + point[0] - 7.).clamp(0., (size[0] - 14.).max(0.)),
            (center[1] + point[1] - 7.).clamp(0., (size[1] - 14.).max(0.)),
        ];
        layer = layer.child(outline).child(grip(
            "spatial-rotate",
            "Rotate image",
            at,
            Handle::Rotate,
            rect,
            scale,
        ));
    } else {
        layer = layer.child(outline);
        if dimensions(&operation).is_some() {
            layer = layer.child(grip(
                "spatial-resize",
                "Resize image area",
                [
                    (x + target[0] - 7.).clamp(0., (size[0] - 14.).max(0.)),
                    (y + target[1] - 7.).clamp(0., (size[1] - 14.).max(0.)),
                ],
                Handle::Resize,
                rect,
                scale,
            ));
        }
    }
    if s.spatial.as_ref().is_some_and(|gesture| gesture.committed) {
        layer = layer.inert();
    }
    el().w_full()
        .h_full()
        .instant_changes()
        .clip_rounded(0.)
        .child(visible)
        .child(layer)
}

#[cfg(test)]
mod tests {
    use crate::ui::tests::{add, click, enter, runtime, settle};
    #[test]
    fn rotate_previews_without_rendering_then_commits_one_undoable_edit() {
        let mut rt = runtime((980., 820.), false);
        add(&mut rt, "Negate");
        add(&mut rt, "Rotate");
        add(&mut rt, "Gamma");
        click(&mut rt, "collapse-2");
        assert!(rt.find("spatial-rotate").is_none());
        assert_eq!(rt.state.selected, None);
        click(&mut rt, "preview-2");
        rt.state.seek(5);
        rt.frame(0.01);
        let original = rt.state.cards[1].operation.clone();
        let label = rt.state.history.undo_label().unwrap().to_owned();
        let (x, y) = rt.find("spatial-rotate").unwrap();
        rt.pointer_down(x, y);
        rt.frame(0.01);
        assert!(rt.state.spatial.is_some());
        rt.pointer_move(x + 50., y + 30.);
        rt.frame(0.01);
        assert_ne!(rt.state.spatial.as_ref().unwrap().current, original);
        assert_eq!(rt.state.cards[1].operation, original);
        assert!(!rt.state.worker.busy());
        assert_eq!(rt.state.history.undo_label(), Some(label.as_str()));
        rt.pointer_up(x + 50., y + 30.);
        rt.frame(0.01);
        settle(&mut rt);
        assert!(rt.state.spatial.is_none());
        assert_ne!(rt.state.cards[1].operation, original);
        assert_eq!(rt.state.selected, Some(2));
        assert_eq!(rt.state.frame, 5);
        assert_eq!(rt.state.history.undo_label(), Some("Transform in preview"));
        rt.state.undo();
        settle(&mut rt);
        assert_eq!(rt.state.cards[1].operation, original);
    }
    #[test]
    fn spatial_resize_handles_commit_for_all_size_operations() {
        for title in [
            "Resize",
            "Fit inside box",
            "Fill and crop",
            "Canvas size",
            "Crop",
        ] {
            let mut rt = runtime((980., 820.), false);
            add(&mut rt, title);
            let original = rt.state.cards[0].operation.clone();
            let (x, y) = rt
                .find("spatial-resize")
                .unwrap_or_else(|| panic!("No resize handle for {title}"));
            rt.pointer_down(x, y);
            rt.frame(0.01);
            assert!(rt.state.spatial.is_some(), "Handle unreachable for {title}");
            rt.pointer_move(x - 30., y - 20.);
            rt.frame(0.01);
            assert!(!rt.state.worker.busy());
            rt.pointer_up(x - 30., y - 20.);
            rt.frame(0.01);
            settle(&mut rt);
            assert_ne!(rt.state.cards[0].operation, original, "{title}");
            assert_eq!(rt.state.history.undo_label(), Some("Transform in preview"));
            rt.state.undo();
            settle(&mut rt);
            assert_eq!(rt.state.cards[0].operation, original);
        }
    }
    #[test]
    fn crop_and_wraparound_shift_move_in_image_pixels_and_cancel_on_blur() {
        for title in ["Crop", "Wraparound shift"] {
            let mut rt = runtime((980., 820.), false);
            add(&mut rt, title);
            if title == "Crop" {
                enter(&mut rt, "width-1", "160");
                enter(&mut rt, "height-1", "120");
            }
            let original = rt.state.cards[0].operation.clone();
            let fields: Vec<_> = rt.state.fields[&1].iter().map(|f| f.text.clone()).collect();
            let (x, y) = rt.find("spatial-selection").unwrap();
            rt.pointer_down(x, y);
            rt.frame(0.01);
            rt.pointer_move(x + 30., y + 20.);
            rt.frame(0.01);
            assert_ne!(rt.state.spatial.as_ref().unwrap().current, original);
            assert_eq!(rt.state.cards[0].operation, original);
            rt.window_focus(false);
            rt.frame(0.01);
            assert!(rt.state.spatial.is_none());
            assert_eq!(rt.state.cards[0].operation, original);
            assert_eq!(
                rt.state.fields[&1]
                    .iter()
                    .map(|f| f.text.clone())
                    .collect::<Vec<_>>(),
                fields
            );
            assert!(!rt.state.worker.busy());
        }
    }
}
