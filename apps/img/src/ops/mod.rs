mod catalog;
mod color;
mod composite;
mod effects;
mod geometry;
pub(crate) mod lut;
mod timeline;
use crate::{Animation, Frame, MAX_BYTES, MAX_FRAMES, dimensions};
use anyhow::{Result, ensure};
pub use catalog::{Operation, Parameter, ParameterKind};

pub(crate) struct Plan {
    pub width: u32,
    pub height: u32,
    pub frames: usize,
    pub allocation: usize,
    pub crop: (u32, u32),
    overlay: Option<composite::OverlayPlan>,
}
impl Operation {
    pub(crate) fn plan(&self, source: &Animation) -> Result<Plan> {
        self.validate_parameters()?;
        if let Self::Text { font, .. } = self {
            crate::fonts::resolve(font)?;
        }
        let (w, h) = source.frames[0].pixels.dimensions();
        let n = source.frames.len();
        let mut p = Plan {
            width: w,
            height: h,
            frames: n,
            allocation: 0,
            crop: (0, 0),
            overlay: None,
        };
        use Operation::*;
        match *self {
            Resize { width, height } | Fill { width, height } | Canvas { width, height } => {
                p.width = width;
                p.height = height;
            }
            Fit { width, height } => {
                (p.width, p.height) = geometry::fit_size(w, h, width, height);
            }
            Crop {
                x,
                y,
                width,
                height,
            } => {
                ensure!(
                    x as u64 + width as u64 <= w as u64 && y as u64 + height as u64 <= h as u64,
                    "Crop must fit inside {w} × {h} pixels"
                );
                p.width = width;
                p.height = height;
                p.crop = (x, y);
            }
            Border { pixels, .. } => {
                p.width = w + 2 * pixels;
                p.height = h + 2 * pixels;
            }
            Rotate { degrees } => {
                (p.width, p.height) = geometry::rotated_size(w, h, degrees);
            }
            Rotate90 | Rotate270 | Transpose => {
                p.width = h;
                p.height = w;
            }
            TrimTransparent => {
                let (x, y, width, height) = geometry::visible_bounds(source);
                p.crop = (x, y);
                p.width = width;
                p.height = height;
            }
            TrimFrames { first, last } => {
                ensure!(
                    first <= last && last as usize <= n,
                    "Choose a frame range inside 1–{n}"
                );
                p.frames = (last - first + 1) as usize;
            }
            KeepEvery { step } => p.frames = n.div_ceil(step as usize),
            PingPong => p.frames = if n > 1 { 2 * n - 2 } else { 1 },
            RepeatFrames { times } => {
                p.frames = n
                    .checked_mul(times as usize)
                    .ok_or_else(|| anyhow::anyhow!("Too many frames"))?
            }
            ShiftFrames { offset } => {
                ensure!(offset as usize <= n, "Starting frame must be inside 1–{n}")
            }
            FadeIn { frames, .. } | FadeOut { frames, .. } => {
                ensure!(frames as usize <= n, "Fade must use 1–{n} frames")
            }
            Overlay {
                ref path,
                width,
                percent,
                x,
                y,
            } if !path.is_empty() && percent > 0. => {
                let asset = composite::load_overlay(path, width)?;
                let (aw, ah) = asset.frames[0].pixels.dimensions();
                if x < w as i32 && y < h as i32 && x + aw as i32 > 0 && y + ah as i32 > 0 {
                    let prepared = composite::prepare_overlay(source, asset)?;
                    p.frames = prepared.frames.len();
                    p.overlay = Some(prepared);
                }
            }
            _ => {}
        }
        dimensions(p.width, p.height)?;
        ensure!(
            p.frames > 0 && p.frames <= MAX_FRAMES,
            "Operation would produce {} frames; maximum is {MAX_FRAMES}",
            p.frames
        );
        let bytes = p.width as u64 * p.height as u64 * p.frames as u64 * 4;
        ensure!(
            bytes <= MAX_BYTES as u64,
            "Operation would exceed 256 MiB decoded pixels"
        );
        let metadata = matches!(
            self,
            Reverse
                | Speed { .. }
                | SetDelay { .. }
                | FrameRate { .. }
                | TrimFrames { .. }
                | KeepEvery { .. }
                | PingPong
                | RepeatFrames { .. }
                | LoopCount { .. }
                | HoldFirst { .. }
                | HoldLast { .. }
                | ShiftFrames { .. }
                | RemoveDuplicates
        );
        let inactive_overlay = matches!(self, Overlay { .. }) && p.overlay.is_none();
        let empty_text = matches!(self,Text{text,..} if text.is_empty());
        let unchanged = inactive_overlay
            || empty_text
            || matches!(self, Resize { .. } | Fit { .. }) && (p.width, p.height) == (w, h)
            || matches!(self,Rotate{degrees} if degrees.rem_euclid(360.)==0.);
        if !metadata && !unchanged {
            p.allocation = match self {
                FadeIn { frames, .. } | FadeOut { frames, .. } => {
                    w as usize * h as usize * 4 * *frames as usize
                }
                _ => {
                    let count = if let Some(prepared) = &p.overlay {
                        let pairs: std::collections::HashSet<_> = prepared
                            .frames
                            .iter()
                            .map(|f| {
                                (
                                    std::sync::Arc::as_ptr(&source.frames[f.base].pixels),
                                    std::sync::Arc::as_ptr(
                                        &prepared.asset.frames[f.overlay].pixels,
                                    ),
                                )
                            })
                            .collect();
                        pairs.len()
                    } else if matches!(self, Noise { .. }) {
                        p.frames
                    } else {
                        let unique: std::collections::HashSet<_> = source
                            .frames
                            .iter()
                            .map(|f| std::sync::Arc::as_ptr(&f.pixels))
                            .collect();
                        unique.len()
                    };
                    p.width as usize * p.height as usize * 4 * count
                }
            };
        }
        Ok(p)
    }
    pub(crate) fn apply(&self, source: &Animation, plan: &Plan) -> Result<Animation> {
        use Operation::*;
        let result = match self {
            Reverse
            | Speed { .. }
            | SetDelay { .. }
            | FrameRate { .. }
            | TrimFrames { .. }
            | KeepEvery { .. }
            | PingPong
            | RepeatFrames { .. }
            | LoopCount { .. }
            | HoldFirst { .. }
            | HoldLast { .. }
            | ShiftFrames { .. }
            | RemoveDuplicates => timeline::apply(self, source)?,
            Resize { .. }
            | Fit { .. }
            | Fill { .. }
            | Crop { .. }
            | Canvas { .. }
            | Border { .. }
            | Rotate { .. }
            | Rotate90
            | Rotate180
            | Rotate270
            | FlipHorizontal
            | FlipVertical
            | Transpose
            | Roll { .. }
            | TrimTransparent => geometry::apply(self, source, plan),
            Text { .. } | Overlay { .. } => composite::apply(self, source, plan),
            Negate
            | Grayscale
            | Sepia
            | Brightness { .. }
            | Contrast { .. }
            | Gamma { .. }
            | Saturation { .. }
            | Hue { .. }
            | Exposure { .. }
            | ColorBalance { .. }
            | ColorTint { .. }
            | Threshold { .. }
            | Posterize { .. }
            | Solarize { .. }
            | AutoLevels
            | Opacity { .. }
            | Matte { .. }
            | ColorKey { .. }
            | AlphaThreshold { .. }
            | AlphaMask
            | FadeIn { .. }
            | FadeOut { .. }
            | Quantize { .. }
            | RoundCorners { .. } => color::apply(self, source),
            Blur { .. }
            | Sharpen { .. }
            | Pixelate { .. }
            | Edges
            | Emboss { .. }
            | Noise { .. }
            | OrderedDither { .. }
            | Dither { .. }
            | Vignette { .. }
            | Scanlines { .. }
            | Swirl { .. }
            | Wave { .. } => effects::apply(self, source),
        };
        ensure!(
            result.frames.len() <= plan.frames,
            "Operation exceeded its frame estimate"
        );
        ensure!(
            result
                .frames
                .iter()
                .all(|f| f.pixels.dimensions() == (plan.width, plan.height)),
            "Operation produced unexpected dimensions"
        );
        Ok(result)
    }
}
fn map_frames(
    source: &Animation,
    frame_invariant: bool,
    mut transform: impl FnMut(&image::RgbaImage, usize) -> image::RgbaImage,
) -> Animation {
    let mut cache = std::collections::HashMap::new();
    Animation {
        repeat: source.repeat,
        frames: source
            .frames
            .iter()
            .enumerate()
            .map(|(i, f)| {
                let key = std::sync::Arc::as_ptr(&f.pixels);
                let pixels = if frame_invariant {
                    cache
                        .entry(key)
                        .or_insert_with(|| std::sync::Arc::new(transform(&f.pixels, i)))
                        .clone()
                } else {
                    std::sync::Arc::new(transform(&f.pixels, i))
                };
                Frame {
                    pixels,
                    delay_ms: f.delay_ms,
                }
            })
            .collect(),
    }
}
