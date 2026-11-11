use super::color::{byte, luma};
use super::geometry::{premultiply, sample, unpremultiply};
use super::*;
use image::{Rgba, RgbaImage, imageops};
fn blur(src: &RgbaImage, sigma: f32) -> RgbaImage {
    unpremultiply(imageops::blur(&premultiply(src), sigma))
}
fn neighbor(src: &RgbaImage, x: i32, y: i32) -> Rgba<u8> {
    *src.get_pixel(
        x.clamp(0, src.width() as i32 - 1) as u32,
        y.clamp(0, src.height() as i32 - 1) as u32,
    )
}
fn diffuse(src: &RgbaImage, levels: u32) -> RgbaImage {
    let mut out = src.clone();
    let w = src.width() as usize;
    let step = 255. / (levels - 1) as f32;
    let mut errors = vec![[0f32; 3]; w + 2];
    let mut next = errors.clone();
    for y in 0..src.height() {
        for x in 0..w {
            let p = out.get_pixel_mut(x as u32, y);
            if p[3] == 0 {
                continue;
            }
            for c in 0..3 {
                let old = (p[c] as f32 + errors[x + 1][c]).clamp(0., 255.);
                let new = byte((old / step).round() * step);
                p[c] = new;
                let error = old - new as f32;
                errors[x + 2][c] += error * 7. / 16.;
                next[x][c] += error * 3. / 16.;
                next[x + 1][c] += error * 5. / 16.;
                next[x + 2][c] += error / 16.;
            }
        }
        std::mem::swap(&mut errors, &mut next);
        next.fill([0.; 3]);
    }
    out
}
pub(super) fn apply(op: &Operation, source: &Animation) -> Animation {
    use Operation::*;
    super::map_frames(source, !matches!(op, Noise { .. }), |src, index| {
        let (w, h) = src.dimensions();
        match *op {
            Blur { sigma } => blur(src, sigma),
            Sharpen { sigma, threshold } => {
                let blurred = blur(src, sigma);
                RgbaImage::from_fn(w, h, |x, y| {
                    let mut p = *src.get_pixel(x, y);
                    let b = blurred.get_pixel(x, y);
                    for c in 0..3 {
                        let delta = p[c] as i32 - b[c] as i32;
                        if delta.abs() > threshold {
                            p[c] = (p[c] as i32 + delta).clamp(0, 255) as u8;
                        }
                    }
                    p
                })
            }
            Pixelate { block } => {
                let small = imageops::resize(
                    src,
                    w.div_ceil(block),
                    h.div_ceil(block),
                    imageops::FilterType::Nearest,
                );
                imageops::resize(&small, w, h, imageops::FilterType::Nearest)
            }
            Edges => RgbaImage::from_fn(w, h, |x, y| {
                let mut gx = 0f32;
                let mut gy = 0f32;
                for (j, row) in [[-1., 0., 1.], [-2., 0., 2.], [-1., 0., 1.]]
                    .iter()
                    .enumerate()
                {
                    for (i, weight) in row.iter().enumerate() {
                        let p = neighbor(src, x as i32 + i as i32 - 1, y as i32 + j as i32 - 1);
                        gx += luma(&p) * p[3] as f32 / 255. * weight;
                    }
                }
                for (j, row) in [[-1., -2., -1.], [0., 0., 0.], [1., 2., 1.]]
                    .iter()
                    .enumerate()
                {
                    for (i, weight) in row.iter().enumerate() {
                        let p = neighbor(src, x as i32 + i as i32 - 1, y as i32 + j as i32 - 1);
                        gy += luma(&p) * p[3] as f32 / 255. * weight;
                    }
                }
                let v = byte(gx.hypot(gy));
                Rgba([v, v, v, src.get_pixel(x, y)[3]])
            }),
            Emboss { strength } => RgbaImage::from_fn(w, h, |x, y| {
                let mut value = [128f32; 3];
                for (j, row) in [[-2., -1., 0.], [-1., 0., 1.], [0., 1., 2.]]
                    .iter()
                    .enumerate()
                {
                    for (i, weight) in row.iter().enumerate() {
                        let p = neighbor(src, x as i32 + i as i32 - 1, y as i32 + j as i32 - 1);
                        for c in 0..3 {
                            value[c] += p[c] as f32 * p[3] as f32 / 255. * weight * strength;
                        }
                    }
                }
                Rgba([
                    byte(value[0]),
                    byte(value[1]),
                    byte(value[2]),
                    src.get_pixel(x, y)[3],
                ])
            }),
            Noise { amount, seed } => {
                let mut state = seed.wrapping_add((index as u32).wrapping_mul(0x9e3779b9));
                RgbaImage::from_fn(w, h, |x, y| {
                    let mut p = *src.get_pixel(x, y);
                    for c in 0..3 {
                        state = state.wrapping_add(0x9e3779b9);
                        let mut z = state;
                        z = (z ^ (z >> 16)).wrapping_mul(0x21f0aaad);
                        z = (z ^ (z >> 15)).wrapping_mul(0x735a2d97);
                        z ^= z >> 15;
                        let delta = (z % (amount * 2 + 1)) as i32 - amount as i32;
                        p[c] = (p[c] as i32 + delta).clamp(0, 255) as u8;
                    }
                    p
                })
            }
            OrderedDither { levels } => {
                let bayer = [
                    [0., 8., 2., 10.],
                    [12., 4., 14., 6.],
                    [3., 11., 1., 9.],
                    [15., 7., 13., 5.],
                ];
                let step = 255. / (levels - 1) as f32;
                RgbaImage::from_fn(w, h, |x, y| {
                    let mut p = *src.get_pixel(x, y);
                    let offset = ((bayer[y as usize % 4][x as usize % 4] + 0.5) / 16. - 0.5) * step;
                    for c in 0..3 {
                        p[c] = byte(((p[c] as f32 + offset) / step).round() * step);
                    }
                    p
                })
            }
            Dither { levels } => diffuse(src, levels),
            Vignette { percent } => RgbaImage::from_fn(w, h, |x, y| {
                let mut p = *src.get_pixel(x, y);
                let dx = (2. * x as f32 - (w - 1) as f32) / (w - 1).max(1) as f32;
                let dy = (2. * y as f32 - (h - 1) as f32) / (h - 1).max(1) as f32;
                let factor = 1. - (dx * dx + dy * dy) / 2. * percent / 100.;
                for c in 0..3 {
                    p[c] = byte(p[c] as f32 * factor);
                }
                p
            }),
            Scanlines { spacing, percent } => RgbaImage::from_fn(w, h, |x, y| {
                let mut p = *src.get_pixel(x, y);
                if y % spacing == 0 {
                    for c in 0..3 {
                        p[c] = byte(p[c] as f32 * (1. - percent / 100.));
                    }
                }
                p
            }),
            Swirl { degrees } => RgbaImage::from_fn(w, h, |x, y| {
                let (cx, cy) = ((w - 1) as f32 / 2., (h - 1) as f32 / 2.);
                let (dx, dy) = (x as f32 - cx, y as f32 - cy);
                let radius = w.min(h) as f32 / 2.;
                let r = dx.hypot(dy) / radius;
                if r >= 1. {
                    *src.get_pixel(x, y)
                } else {
                    let (s, c) = (degrees.to_radians() * (1. - r).powi(2)).sin_cos();
                    sample(src, c * dx + s * dy + cx, -s * dx + c * dy + cy, false)
                }
            }),
            Wave {
                amplitude,
                wavelength,
            } => RgbaImage::from_fn(w, h, |x, y| {
                sample(
                    src,
                    x as f32 - amplitude * (std::f32::consts::TAU * y as f32 / wavelength).sin(),
                    y as f32,
                    false,
                )
            }),
            _ => unreachable!("Effects dispatch"),
        }
    })
}
