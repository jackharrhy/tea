use super::*;
use ab_glyph::{Font, PxScale, ScaleFont, point};
use image::{Rgba, RgbaImage};
use std::path::Path;

pub(super) struct OverlayPlan {
    pub asset: Animation,
    pub frames: Vec<OverlayFrame>,
}
pub(super) struct OverlayFrame {
    pub base: usize,
    pub overlay: usize,
    pub delay_ms: u32,
}
pub(super) fn prepare_overlay(source: &Animation, asset: Animation) -> Result<OverlayPlan> {
    let mut frames = Vec::new();
    if asset.frames.len() == 1 {
        frames = source
            .frames
            .iter()
            .enumerate()
            .map(|(base, f)| OverlayFrame {
                base,
                overlay: 0,
                delay_ms: f.delay_ms,
            })
            .collect();
    } else {
        let (mut base, mut overlay) = (0, 0);
        let mut base_left = source.frames[0].delay_ms.max(10);
        let mut overlay_left = asset.frames[0].delay_ms.max(10);
        while base < source.frames.len() {
            ensure!(
                frames.len() < MAX_FRAMES,
                "Overlay would exceed {MAX_FRAMES} frames; reduce frame rates or shorten the source"
            );
            let delay_ms = base_left.min(overlay_left);
            frames.push(OverlayFrame {
                base,
                overlay,
                delay_ms,
            });
            base_left -= delay_ms;
            overlay_left -= delay_ms;
            if base_left == 0 {
                base += 1;
                if base < source.frames.len() {
                    base_left = source.frames[base].delay_ms.max(10);
                }
            }
            if overlay_left == 0 {
                overlay = (overlay + 1) % asset.frames.len();
                overlay_left = asset.frames[overlay].delay_ms.max(10);
            }
        }
    }
    Ok(OverlayPlan { asset, frames })
}
pub(super) fn load_overlay(path: &str, width: u32) -> Result<Animation> {
    let mut asset = Animation::load_image(Path::new(path))?;
    if width > 0 && width != asset.frames[0].pixels.width() {
        let (w, h) = asset.frames[0].pixels.dimensions();
        let height = (h as f64 * width as f64 / w as f64).round().max(1.) as u32;
        let op = Operation::Resize { width, height };
        let plan = op.plan(&asset)?;
        asset = op.apply(&asset, &plan)?;
    }
    Ok(asset)
}
fn layout_text(op: &Operation, mut visit: impl FnMut(ab_glyph::OutlinedGlyph)) {
    let Operation::Text {
        text,
        size,
        x,
        y,
        font,
        tracking,
        leading,
        align,
        ..
    } = op
    else {
        return;
    };
    let Ok(font) = crate::fonts::resolve(font) else {
        return;
    };
    let scale = PxScale::from(*size as f32);
    let scaled = font.as_scaled(scale);
    let lines: Vec<_> = text.split('\n').collect();
    let advance = |line: &str| {
        let mut width = 0.;
        let mut previous = None;
        for c in line.chars().filter(|c| *c != '\r') {
            if c == '\t' {
                width += scaled.h_advance(font.glyph_id(' ')) * 4.;
                previous = None;
                continue;
            }
            let id = font.glyph_id(c);
            if let Some(prev) = previous {
                width += scaled.kern(prev, id) + tracking;
            }
            width += scaled.h_advance(id);
            previous = Some(id);
        }
        width
    };
    let widest = lines.iter().map(|line| advance(line)).fold(0_f32, f32::max);
    for (index, line) in lines.iter().enumerate() {
        let offset = (widest - advance(line)) * (*align as f32 / 2.);
        let mut pen = point(
            *x as f32 + offset,
            *y as f32
                + scaled.ascent()
                + index as f32 * (scaled.height() + scaled.line_gap()) * leading / 100.,
        );
        let mut previous = None;
        for c in line.chars().filter(|c| *c != '\r') {
            if c == '\t' {
                pen.x += scaled.h_advance(font.glyph_id(' ')) * 4.;
                previous = None;
                continue;
            }
            let id = font.glyph_id(c);
            if let Some(prev) = previous {
                pen.x += scaled.kern(prev, id) + tracking;
            }
            if let Some(outline) = font.outline_glyph(id.with_scale_and_position(scale, pen)) {
                visit(outline);
            }
            pen.x += scaled.h_advance(id);
            previous = Some(id);
        }
    }
}

impl Operation {
    /// Visible text bounds, including outline, in image pixels. Unclipped by the canvas.
    pub fn text_bounds(&self) -> Option<[i32; 4]> {
        let Self::Text { outline, .. } = self else {
            return None;
        };
        self.validate_parameters().ok()?;
        let mut bounds = [i32::MAX, i32::MAX, i32::MIN, i32::MIN];
        layout_text(self, |glyph| {
            let rect = glyph.px_bounds();
            bounds[0] = bounds[0].min(rect.min.x.floor() as i32);
            bounds[1] = bounds[1].min(rect.min.y.floor() as i32);
            bounds[2] = bounds[2].max(rect.max.x.ceil() as i32);
            bounds[3] = bounds[3].max(rect.max.y.ceil() as i32);
        });
        if bounds[0] == i32::MAX {
            return None;
        }
        let pad = *outline as i32;
        Some([
            bounds[0] - pad,
            bounds[1] - pad,
            bounds[2] - bounds[0] + pad * 2,
            bounds[3] - bounds[1] + pad * 2,
        ])
    }
}
fn text_mask(op: &Operation, w: u32, h: u32) -> (Vec<u8>, [u32; 4]) {
    let mut mask = vec![0u8; w as usize * h as usize];
    let mut bounds = [w, h, 0, 0];
    layout_text(op, |outline| {
        let rect = outline.px_bounds();
        if rect.max.x > 0. && rect.max.y > 0. && rect.min.x < w as f32 && rect.min.y < h as f32 {
            outline.draw(|gx, gy, coverage| {
                let px = rect.min.x as i32 + gx as i32;
                let py = rect.min.y as i32 + gy as i32;
                if px >= 0 && py >= 0 && px < w as i32 && py < h as i32 {
                    let (px, py) = (px as u32, py as u32);
                    let alpha = super::color::byte(coverage * 255.);
                    let index = (py * w + px) as usize;
                    mask[index] = mask[index].max(alpha);
                    if alpha > 0 {
                        bounds[0] = bounds[0].min(px);
                        bounds[1] = bounds[1].min(py);
                        bounds[2] = bounds[2].max(px + 1);
                        bounds[3] = bounds[3].max(py + 1);
                    }
                }
            });
        }
    });
    (mask, bounds)
}
fn dilate(mask: &[u8], w: u32, h: u32, radius: u32, bounds: [u32; 4]) -> Vec<u8> {
    if radius == 0 || bounds[2] == 0 {
        return vec![0; mask.len()];
    }
    let mut horizontal = vec![0u8; mask.len()];
    let mut output = horizontal.clone();
    let left = bounds[0].saturating_sub(radius);
    let top = bounds[1].saturating_sub(radius);
    let right = (bounds[2] + radius).min(w);
    let bottom = (bounds[3] + radius).min(h);
    for y in bounds[1]..bounds[3] {
        for x in left..right {
            horizontal[(y * w + x) as usize] = (x.saturating_sub(radius)..=(x + radius).min(w - 1))
                .map(|xx| mask[(y * w + xx) as usize])
                .max()
                .unwrap_or(0);
        }
    }
    for y in top..bottom {
        for x in left..right {
            output[(y * w + x) as usize] = (y.saturating_sub(radius)..=(y + radius).min(h - 1))
                .map(|yy| horizontal[(yy * w + x) as usize])
                .max()
                .unwrap_or(0);
        }
    }
    output
}
pub(super) fn apply(op: &Operation, source: &Animation, plan: &Plan) -> Animation {
    match op {
        Operation::Text {
            text,
            red,
            green,
            blue,
            outline,
            ..
        } => {
            if text.is_empty() {
                return source.clone();
            }
            let (w, h) = source.frames[0].pixels.dimensions();
            let (mask, bounds) = text_mask(op, w, h);
            let border = dilate(&mask, w, h, *outline, bounds);
            super::map_frames(source, true, |src, _| {
                RgbaImage::from_fn(w, h, |x, y| {
                    let mut pixel = *src.get_pixel(x, y);
                    let index = (y * w + x) as usize;
                    if border[index] > 0 {
                        blend(&mut pixel, Rgba([0, 0, 0, border[index]]));
                    }
                    if mask[index] > 0 {
                        blend(&mut pixel, Rgba([*red, *green, *blue, mask[index]]));
                    }
                    pixel
                })
            })
        }
        Operation::Overlay { x, y, percent, .. } => {
            let Some(prepared) = &plan.overlay else {
                return source.clone();
            };
            let mut cache = std::collections::HashMap::new();
            let frames = prepared
                .frames
                .iter()
                .map(|segment| {
                    let base = &source.frames[segment.base].pixels;
                    let overlay = &prepared.asset.frames[segment.overlay].pixels;
                    let key = (
                        std::sync::Arc::as_ptr(base),
                        std::sync::Arc::as_ptr(overlay),
                    );
                    let pixels = cache
                        .entry(key)
                        .or_insert_with(|| {
                            let mut out = base.as_ref().clone();
                            let left = (*x).clamp(0, base.width() as i32);
                            let top = (*y).clamp(0, base.height() as i32);
                            let right = (*x + overlay.width() as i32).clamp(0, base.width() as i32);
                            let bottom =
                                (*y + overlay.height() as i32).clamp(0, base.height() as i32);
                            for py in top..bottom {
                                for px in left..right {
                                    let mut pixel =
                                        *overlay.get_pixel((px - *x) as u32, (py - *y) as u32);
                                    pixel[3] = super::color::byte(pixel[3] as f32 * percent / 100.);
                                    blend(out.get_pixel_mut(px as u32, py as u32), pixel);
                                }
                            }
                            std::sync::Arc::new(out)
                        })
                        .clone();
                    Frame {
                        pixels,
                        delay_ms: segment.delay_ms,
                    }
                })
                .collect();
            Animation {
                frames,
                repeat: source.repeat,
            }
        }
        _ => unreachable!("Composite dispatch"),
    }
}

fn blend(base: &mut Rgba<u8>, over: Rgba<u8>) {
    let sa = over[3] as u32;
    if sa == 0 {
        return;
    }
    let da = base[3] as u32;
    let alpha = sa * 255 + da * (255 - sa);
    for c in 0..3 {
        let value = over[c] as u32 * sa * 255 + base[c] as u32 * da * (255 - sa);
        base[c] = ((value + alpha / 2) / alpha) as u8;
    }
    base[3] = ((alpha + 127) / 255) as u8;
}
