use super::*;
use image::{Rgba, RgbaImage, imageops};
pub(super) fn fit_size(w: u32, h: u32, width: u32, height: u32) -> (u32, u32) {
    let scale = (width as f64 / w as f64).min(height as f64 / h as f64);
    (
        (w as f64 * scale).round().max(1.) as u32,
        (h as f64 * scale).round().max(1.) as u32,
    )
}
pub(super) fn rotated_size(w: u32, h: u32, degrees: f32) -> (u32, u32) {
    let angle = degrees.rem_euclid(360.);
    if (angle / 90. - (angle / 90.).round()).abs() < 0.00001 {
        return if ((angle / 90.).round() as u32).is_multiple_of(2) {
            (w, h)
        } else {
            (h, w)
        };
    };
    let (s, c) = angle.to_radians().sin_cos();
    (
        (w as f32 * c.abs() + h as f32 * s.abs()).ceil() as u32,
        (w as f32 * s.abs() + h as f32 * c.abs()).ceil() as u32,
    )
}
pub(super) fn visible_bounds(source: &Animation) -> (u32, u32, u32, u32) {
    let (w, h) = source.frames[0].pixels.dimensions();
    let (mut left, mut top, mut right, mut bottom) = (w, h, 0, 0);
    for frame in &source.frames {
        for (x, y, p) in frame.pixels.enumerate_pixels() {
            if p[3] > 0 {
                left = left.min(x);
                top = top.min(y);
                right = right.max(x + 1);
                bottom = bottom.max(y + 1);
            }
        }
    }
    if right == 0 {
        (0, 0, 1, 1)
    } else {
        (left, top, right - left, bottom - top)
    }
}
// Interpolate premultiplied channels, then return straight alpha. Outside is transparent.
pub(super) fn sample(src: &RgbaImage, x: f32, y: f32, clamp: bool) -> Rgba<u8> {
    let (x, y) = if clamp {
        (
            x.clamp(0., (src.width() - 1) as f32),
            y.clamp(0., (src.height() - 1) as f32),
        )
    } else {
        (x, y)
    };
    let (ix, iy) = (x.floor() as i32, y.floor() as i32);
    let (fx, fy) = (x - ix as f32, y - iy as f32);
    let mut out = [0f32; 4];
    for (dx, dy, weight) in [
        (0, 0, (1. - fx) * (1. - fy)),
        (1, 0, fx * (1. - fy)),
        (0, 1, (1. - fx) * fy),
        (1, 1, fx * fy),
    ] {
        let (sx, sy) = (ix + dx, iy + dy);
        if sx < 0 || sy < 0 || sx >= src.width() as i32 || sy >= src.height() as i32 {
            continue;
        }
        let p = src.get_pixel(sx as u32, sy as u32);
        let alpha = p[3] as f32 / 255.;
        for c in 0..3 {
            out[c] += p[c] as f32 * alpha * weight;
        }
        out[3] += p[3] as f32 * weight;
    }
    let mut p = [0u8; 4];
    p[3] = out[3].round().clamp(0., 255.) as u8;
    if out[3] > 0. {
        for c in 0..3 {
            p[c] = (out[c] * 255. / out[3]).round().clamp(0., 255.) as u8;
        }
    }
    Rgba(p)
}
pub(super) fn premultiply(src: &RgbaImage) -> RgbaImage {
    RgbaImage::from_fn(src.width(), src.height(), |x, y| {
        let mut p = *src.get_pixel(x, y);
        for c in 0..3 {
            p[c] = ((p[c] as u32 * p[3] as u32 + 127) / 255) as u8;
        }
        p
    })
}
pub(super) fn unpremultiply(mut src: RgbaImage) -> RgbaImage {
    for p in src.pixels_mut() {
        for c in 0..3 {
            p[c] = if p[3] == 0 {
                0
            } else {
                ((p[c] as u32 * 255 + p[3] as u32 / 2) / p[3] as u32).min(255) as u8
            };
        }
    }
    src
}
pub(super) fn resize(src: &RgbaImage, w: u32, h: u32) -> RgbaImage {
    if src.pixels().all(|p| p[3] == 255) {
        imageops::resize(src, w, h, imageops::FilterType::Triangle)
    } else {
        unpremultiply(imageops::resize(
            &premultiply(src),
            w,
            h,
            imageops::FilterType::Triangle,
        ))
    }
}
pub(super) fn apply(op: &Operation, source: &Animation, plan: &Plan) -> Animation {
    use Operation::*;
    let (w, h) = source.frames[0].pixels.dimensions();
    if matches!(op, Resize { .. } | Fit { .. }) && (plan.width, plan.height) == (w, h)
        || matches!(op,Rotate{degrees}if degrees.rem_euclid(360.)==0.)
    {
        return source.clone();
    }
    super::map_frames(source, true, |src, _| match *op {
        Resize { .. } | Fit { .. } => resize(src, plan.width, plan.height),
        Fill { width, height } => {
            let scale = (width as f32 / w as f32).max(height as f32 / h as f32);
            RgbaImage::from_fn(width, height, |x, y| {
                sample(
                    src,
                    (x as f32 + 0.5 - width as f32 / 2.) / scale + w as f32 / 2. - 0.5,
                    (y as f32 + 0.5 - height as f32 / 2.) / scale + h as f32 / 2. - 0.5,
                    true,
                )
            })
        }
        Crop { .. } | TrimTransparent => {
            imageops::crop_imm(src, plan.crop.0, plan.crop.1, plan.width, plan.height).to_image()
        }
        Canvas { width, height } => {
            let mut output = RgbaImage::new(width, height);
            imageops::overlay(
                &mut output,
                src,
                (width as i64 - w as i64) / 2,
                (height as i64 - h as i64) / 2,
            );
            output
        }
        Border {
            pixels,
            red,
            green,
            blue,
        } => {
            let mut output =
                RgbaImage::from_pixel(plan.width, plan.height, Rgba([red, green, blue, 255]));
            // Copy, rather than overlay, so the original image's transparency is retained.
            imageops::replace(&mut output, src, pixels as i64, pixels as i64);
            output
        }
        Rotate { degrees } => {
            let angle = degrees.rem_euclid(360.);
            if angle == 90. {
                imageops::rotate90(src)
            } else if angle == 180. {
                imageops::rotate180(src)
            } else if angle == 270. {
                imageops::rotate270(src)
            } else {
                let (s, c) = angle.to_radians().sin_cos();
                RgbaImage::from_fn(plan.width, plan.height, |x, y| {
                    let dx = x as f32 - (plan.width - 1) as f32 / 2.;
                    let dy = y as f32 - (plan.height - 1) as f32 / 2.;
                    sample(
                        src,
                        c * dx + s * dy + (w - 1) as f32 / 2.,
                        -s * dx + c * dy + (h - 1) as f32 / 2.,
                        false,
                    )
                })
            }
        }
        Rotate90 => imageops::rotate90(src),
        Rotate180 => imageops::rotate180(src),
        Rotate270 => imageops::rotate270(src),
        FlipHorizontal => imageops::flip_horizontal(src),
        FlipVertical => imageops::flip_vertical(src),
        Transpose => imageops::flip_horizontal(&imageops::rotate90(src)),
        Roll { x, y } => RgbaImage::from_fn(w, h, |px, py| {
            *src.get_pixel(
                (px as i32 - x).rem_euclid(w as i32) as u32,
                (py as i32 - y).rem_euclid(h as i32) as u32,
            )
        }),
        _ => unreachable!("Geometry dispatch"),
    })
}
