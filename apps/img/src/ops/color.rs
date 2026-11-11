use super::*;
use image::Rgba;
pub(super) fn byte(value: f32) -> u8 {
    value.round().clamp(0., 255.) as u8
}
pub(super) fn luma(p: &Rgba<u8>) -> f32 {
    0.2126 * p[0] as f32 + 0.7152 * p[1] as f32 + 0.0722 * p[2] as f32
}
fn hue(p: Rgba<u8>, degrees: f32) -> Rgba<u8> {
    let rgb = [p[0] as f32 / 255., p[1] as f32 / 255., p[2] as f32 / 255.];
    let max = rgb.into_iter().fold(0f32, f32::max);
    let min = rgb.into_iter().fold(1f32, f32::min);
    let c = max - min;
    if c == 0. {
        return p;
    }
    let h = if max == rgb[0] {
        (rgb[1] - rgb[2]) / c
    } else if max == rgb[1] {
        (rgb[2] - rgb[0]) / c + 2.
    } else {
        (rgb[0] - rgb[1]) / c + 4.
    };
    let h = (h + degrees / 60.).rem_euclid(6.);
    let x = c * (1. - (h % 2. - 1.).abs());
    let m = max - c;
    let v = match h as u32 {
        0 => [c, x, 0.],
        1 => [x, c, 0.],
        2 => [0., c, x],
        3 => [0., x, c],
        4 => [x, 0., c],
        _ => [c, 0., x],
    };
    Rgba([
        byte((v[0] + m) * 255.),
        byte((v[1] + m) * 255.),
        byte((v[2] + m) * 255.),
        p[3],
    ])
}
fn exposure(channel: u8, stops: f32) -> u8 {
    let value = channel as f32 / 255.;
    let linear = if value <= 0.04045 {
        value / 12.92
    } else {
        ((value + 0.055) / 1.055).powf(2.4)
    } * 2f32.powf(stops);
    let output = if linear <= 0.0031308 {
        linear * 12.92
    } else {
        1.055 * linear.powf(1. / 2.4) - 0.055
    };
    byte(output * 255.)
}
pub(super) fn apply(op: &Operation, source: &Animation) -> Animation {
    use Operation::*;
    let (mut lo, mut hi) = ([255u8; 3], [0u8; 3]);
    if matches!(op, AutoLevels) {
        for f in &source.frames {
            for p in f.pixels.pixels().filter(|p| p[3] > 0) {
                for c in 0..3 {
                    lo[c] = lo[c].min(p[c]);
                    hi[c] = hi[c].max(p[c]);
                }
            }
        }
    }
    let palette = if let Quantize { colors } = *op {
        Some(crate::palette::Palette::new(
            colors as usize,
            source.frames.iter().flat_map(|f| f.pixels.pixels()),
        ))
    } else {
        None
    };
    let mut result = source.clone();
    let mut cache = std::collections::HashMap::new();
    let shared = !matches!(op, FadeIn { .. } | FadeOut { .. });
    for (i, frame) in result.frames.iter_mut().enumerate() {
        let fade = match *op {
            FadeIn { frames, .. } if i >= frames as usize => true,
            FadeOut { frames, .. } if i < source.frames.len() - frames as usize => true,
            _ => false,
        };
        if fade {
            continue;
        }
        let key = std::sync::Arc::as_ptr(&frame.pixels);
        if shared && let Some(pixels) = cache.get(&key) {
            frame.pixels = std::sync::Arc::clone(pixels);
            continue;
        }
        let mut image = frame.pixels.as_ref().clone();
        let (w, h) = image.dimensions();
        for (x, y, p) in image.enumerate_pixels_mut() {
            let original = *p;
            match *op {
                Negate => {
                    for c in 0..3 {
                        p[c] = 255 - p[c];
                    }
                }
                Grayscale => {
                    let l = byte(luma(&original));
                    p.0[..3].fill(l);
                }
                Sepia => {
                    let r = original[0] as f32;
                    let g = original[1] as f32;
                    let b = original[2] as f32;
                    p[0] = byte(0.393 * r + 0.769 * g + 0.189 * b);
                    p[1] = byte(0.349 * r + 0.686 * g + 0.168 * b);
                    p[2] = byte(0.272 * r + 0.534 * g + 0.131 * b);
                }
                Brightness { amount } => {
                    for c in 0..3 {
                        p[c] = (p[c] as i32 + amount).clamp(0, 255) as u8;
                    }
                }
                Contrast { amount } => {
                    let factor = ((100. + amount) / 100.).powi(2);
                    for c in 0..3 {
                        p[c] = byte(((p[c] as f32 / 255. - 0.5) * factor + 0.5) * 255.);
                    }
                }
                Gamma { gamma } => {
                    for c in 0..3 {
                        p[c] = byte((p[c] as f32 / 255.).powf(1. / gamma) * 255.);
                    }
                }
                Saturation { percent } => {
                    let l = luma(&original);
                    for c in 0..3 {
                        p[c] = byte(l + (p[c] as f32 - l) * percent / 100.);
                    }
                }
                Hue { degrees } => *p = hue(original, degrees),
                Exposure { stops } => {
                    for c in 0..3 {
                        p[c] = exposure(p[c], stops);
                    }
                }
                ColorBalance { red, green, blue } => {
                    for (c, offset) in [red, green, blue].iter().enumerate() {
                        p[c] = (p[c] as i32 + offset).clamp(0, 255) as u8;
                    }
                }
                ColorTint {
                    red,
                    green,
                    blue,
                    percent,
                } => {
                    for (c, target) in [red, green, blue].iter().enumerate() {
                        p[c] = byte(
                            p[c] as f32 * (1. - percent / 100.) + *target as f32 * percent / 100.,
                        );
                    }
                }
                Threshold { level } => {
                    let value = if luma(&original) >= level as f32 {
                        255
                    } else {
                        0
                    };
                    p.0[..3].fill(value);
                }
                Posterize { levels } => {
                    let step = 255. / (levels - 1) as f32;
                    for c in 0..3 {
                        p[c] = byte((p[c] as f32 / step).round() * step);
                    }
                }
                Solarize { threshold } => {
                    for c in 0..3 {
                        if p[c] > threshold {
                            p[c] = 255 - p[c];
                        }
                    }
                }
                AutoLevels => {
                    for c in 0..3 {
                        if hi[c] > lo[c] {
                            p[c] =
                                byte((p[c] as f32 - lo[c] as f32) * 255. / (hi[c] - lo[c]) as f32);
                        }
                    }
                }
                Opacity { percent } => p[3] = byte(p[3] as f32 * percent / 100.),
                Matte { red, green, blue } => {
                    let a = p[3] as f32 / 255.;
                    for (c, bg) in [red, green, blue].iter().enumerate() {
                        p[c] = byte(p[c] as f32 * a + *bg as f32 * (1. - a));
                    }
                    p[3] = 255;
                }
                ColorKey {
                    red,
                    green,
                    blue,
                    tolerance,
                } => {
                    if [red, green, blue]
                        .iter()
                        .enumerate()
                        .all(|(c, v)| p[c].abs_diff(*v) <= tolerance)
                    {
                        p[3] = 0;
                    }
                }
                AlphaThreshold { level } => p[3] = if p[3] >= level { 255 } else { 0 },
                AlphaMask => *p = Rgba([original[3], original[3], original[3], 255]),
                FadeIn {
                    frames,
                    red,
                    green,
                    blue,
                }
                | FadeOut {
                    frames,
                    red,
                    green,
                    blue,
                } => {
                    let weight = if matches!(op, FadeIn { .. }) {
                        if frames == 1 {
                            0.
                        } else {
                            1. - i as f32 / (frames - 1) as f32
                        }
                    } else if frames == 1 {
                        1.
                    } else {
                        (i - (source.frames.len() - frames as usize)) as f32 / (frames - 1) as f32
                    };
                    for (c, target) in [red, green, blue].iter().enumerate() {
                        p[c] = byte(p[c] as f32 * (1. - weight) + *target as f32 * weight);
                    }
                }
                Quantize { .. } => *p = palette.as_ref().expect("Prepared palette").map(p),
                RoundCorners { radius } => {
                    let r = (radius as f32).min(w.min(h) as f32 / 2.);
                    if r > 0. {
                        let px = x as f32 + 0.5;
                        let py = y as f32 + 0.5;
                        let cx = px.clamp(r, w as f32 - r);
                        let cy = py.clamp(r, h as f32 - r);
                        let coverage = (r - (px - cx).hypot(py - cy) + 0.5).clamp(0., 1.);
                        p[3] = byte(p[3] as f32 * coverage);
                    }
                }
                _ => unreachable!("Color dispatch"),
            }
        }
        frame.pixels = std::sync::Arc::new(image);
        if shared {
            cache.insert(key, frame.pixels.clone());
        }
    }
    result
}
