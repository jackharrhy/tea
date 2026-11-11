use super::*;
use crate::ui::system_color::SampleResult;
use rune::{Drag, Phase};
use rune_kit::Popover;

const WIDTH: f32 = 232.;
const HEIGHT: f32 = 140.;
#[derive(Default)]
pub(crate) struct Picker {
    pub draft: Option<Draft>,
}
pub(crate) enum Mode {
    Panel,
    Sampling(Option<mpsc::Receiver<SampleResult>>),
}
pub(crate) struct Draft {
    pub target: (u64, usize),
    pub mode: Mode,
    hsv: [f32; 3],
    pub hex: TextEdit,
    synced_hex: String,
    preview_notice: Option<&'static str>,
    error: String,
    resume: Option<bool>,
    square: Pixels,
    hue: Pixels,
}
fn hex(rgb: [u8; 3]) -> String {
    format!("#{:02X}{:02X}{:02X}", rgb[0], rgb[1], rgb[2])
}
fn parse_hex(text: &str) -> Option<[u8; 3]> {
    let text = text.trim().strip_prefix('#').unwrap_or(text.trim());
    if text.len() != 6 || !text.bytes().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let value = u32::from_str_radix(text, 16).ok()?;
    Some([(value >> 16) as u8, (value >> 8) as u8, value as u8])
}
fn hsv(rgb: [u8; 3]) -> [f32; 3] {
    let [r, g, b] = rgb.map(|v| v as f32 / 255.);
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let delta = max - min;
    let hue = if delta == 0. {
        0.
    } else if max == r {
        ((g - b) / delta).rem_euclid(6.) / 6.
    } else if max == g {
        ((b - r) / delta + 2.) / 6.
    } else {
        ((r - g) / delta + 4.) / 6.
    };
    [hue, if max == 0. { 0. } else { delta / max }, max]
}
fn rgb([h, s, v]: [f32; 3]) -> [u8; 3] {
    let h = h.rem_euclid(1.) * 6.;
    let c = v * s;
    let x = c * (1. - (h % 2. - 1.).abs());
    let m = v - c;
    let values = match h as u32 {
        0 => [c, x, 0.],
        1 => [x, c, 0.],
        2 => [0., c, x],
        3 => [0., x, c],
        4 => [x, 0., c],
        _ => [c, 0., x],
    };
    values.map(|value| ((value + m) * 255.).round().clamp(0., 255.) as u8)
}
fn paint(rgb: [u8; 3]) -> Color {
    rune::color::hex(&hex(rgb)).expect("Formatted RGB color")
}
impl Draft {
    fn new(target: (u64, usize), value: [u8; 3]) -> Self {
        let mut draft = Self {
            target,
            mode: Mode::Panel,
            hsv: hsv(value),
            hex: TextEdit::new(hex(value)),
            synced_hex: hex(value),
            preview_notice: None,
            error: String::new(),
            resume: None,
            square: Pixels::new(),
            hue: Pixels::new(),
        };
        draft.update_square();
        let pixels: Vec<_> = (0..256)
            .flat_map(|x| {
                let [r, g, b] = rgb([x as f32 / 255., 1., 1.]);
                [r, g, b, 255]
            })
            .collect();
        draft.hue.set(256, 1, pixels);
        draft
    }
    fn update_square(&mut self) {
        let hue = self.hsv[0];
        let pixels: Vec<_> = (0..HEIGHT as u32)
            .flat_map(|y| {
                (0..WIDTH as u32).flat_map(move |x| {
                    let [r, g, b] =
                        rgb([hue, x as f32 / (WIDTH - 1.), 1. - y as f32 / (HEIGHT - 1.)]);
                    [r, g, b, 255]
                })
            })
            .collect();
        self.square.set(WIDTH as u32, HEIGHT as u32, pixels);
    }
    fn sync_rgb(&mut self, value: [u8; 3]) {
        let mut next = hsv(value);
        if next[1] == 0. {
            next[0] = self.hsv[0];
        }
        let hue_changed = self.hsv[0] != next[0];
        self.hsv = next;
        self.error.clear();
        if hue_changed {
            self.update_square();
        }
    }
    fn set_rgb(&mut self, value: [u8; 3]) {
        self.sync_rgb(value);
        self.synced_hex = hex(value);
        self.hex = TextEdit::new(&self.synced_hex);
    }
    fn set_hsv(&mut self, value: [f32; 3]) {
        let hue_changed = self.hsv[0] != value[0];
        self.hsv = value;
        self.synced_hex = hex(rgb(value));
        self.hex = TextEdit::new(&self.synced_hex);
        self.error.clear();
        if hue_changed {
            self.update_square();
        }
    }
}

impl State {
    pub(crate) fn open_color(&mut self, id: u64, index: usize) {
        self.close_color();
        let Some(fields) = self.fields.get(&id).and_then(|f| f.get(index..index + 3)) else {
            return;
        };
        let values: Option<Vec<u8>> = fields.iter().map(|f| f.text.parse().ok()).collect();
        if let Some(values) = values {
            self.color.draft = Some(Draft::new((id, index), [values[0], values[1], values[2]]));
        }
    }
    pub(crate) fn close_color(&mut self) {
        if let Some(draft) = self.color.draft.take()
            && let Some(resume) = draft.resume
        {
            self.playing = resume;
            self.clock = None;
        }
    }
    fn apply_color(&mut self) {
        if self.worker.is_io() {
            return;
        }
        let Some(draft) = &mut self.color.draft else {
            return;
        };
        let Some(value) = parse_hex(&draft.hex.text) else {
            draft.error = "Enter a six-digit hex color, such as #E87A42.".into();
            return;
        };
        let (id, index) = draft.target;
        if let Some(fields) = self
            .fields
            .get_mut(&id)
            .and_then(|f| f.get_mut(index..index + 3))
        {
            for (field, value) in fields.iter_mut().zip(value) {
                *field = TextEdit::new(value.to_string());
            }
        }
        self.close_color();
        self.apply_parameters(id, &[index, index + 1, index + 2]);
    }
    fn sample_color(&mut self) {
        if self.color.draft.is_none() {
            return;
        }
        let receiver = if cfg!(target_os = "macos") {
            match crate::ui::system_color::sample(self.waker.clone()) {
                Ok(receiver) => Some(receiver),
                Err(error) => {
                    self.color.draft.as_mut().expect("Open picker").error = error;
                    return;
                }
            }
        } else {
            None
        };
        self.begin_color_sampling(receiver);
    }
    pub(crate) fn begin_color_sampling(&mut self, receiver: Option<mpsc::Receiver<SampleResult>>) {
        let Some(draft) = &mut self.color.draft else {
            return;
        };
        if receiver.is_none() && self.displayed.is_none() {
            return;
        }
        if draft.resume.is_none() {
            draft.resume = Some(self.playing);
        }
        self.playing = false;
        draft.preview_notice = None;
        draft.mode = Mode::Sampling(receiver);
    }
    pub(crate) fn poll_color(&mut self) -> bool {
        let Some(draft) = &mut self.color.draft else {
            return false;
        };
        let mut changed = false;
        if draft.hex.text != draft.synced_hex {
            if let Some(value) = parse_hex(&draft.hex.text) {
                draft.sync_rgb(value);
            }
            draft.synced_hex = draft.hex.text.clone();
            changed = true;
        }
        let Mode::Sampling(Some(receiver)) = &draft.mode else {
            return changed;
        };
        let result = match receiver.try_recv() {
            Ok(result) => result,
            Err(mpsc::TryRecvError::Empty) => return changed,
            Err(_) => Err("Screen sampling stopped. Try again.".into()),
        };
        draft.mode = Mode::Panel;
        match result {
            Ok(Some(value)) => draft.set_rgb(value),
            Ok(None) => {}
            Err(error) => draft.error = error,
        }
        true
    }
    fn pick_pixel(&mut self, drag: &Drag) {
        if drag.phase != Phase::Up || drag.cancelled() {
            return;
        }
        let Some(draft) = &mut self.color.draft else {
            return;
        };
        if !matches!(draft.mode, Mode::Sampling(None)) {
            return;
        }
        let Some(animation) = &self.displayed else {
            return;
        };
        let frame = &animation.frames[self.frame].pixels;
        let Some((x, y)) = image_pixel(
            [drag.x, drag.y],
            [drag.w, drag.h],
            frame.dimensions(),
            self.actual_size,
        ) else {
            return;
        };
        let p = frame.get_pixel(x, y);
        if p[3] == 0 {
            draft.preview_notice = Some("Transparent pixel · try another");
            return;
        }
        draft.set_rgb([p[0], p[1], p[2]]);
        draft.mode = Mode::Panel;
    }
}
fn image_pixel(
    point: [f32; 2],
    size: [f32; 2],
    (w, h): (u32, u32),
    actual: bool,
) -> Option<(u32, u32)> {
    let scale = if actual {
        1.
    } else {
        (size[0] / w as f32).min(size[1] / h as f32)
    };
    if scale <= 0. {
        return None;
    }
    let origin = if actual {
        [0., 0.]
    } else {
        [
            (size[0] - w as f32 * scale) / 2.,
            (size[1] - h as f32 * scale) / 2.,
        ]
    };
    let x = (point[0] - origin[0]) / scale;
    let y = (point[1] - origin[1]) / scale;
    (x >= 0. && y >= 0. && x < w as f32 && y < h as f32)
        .then_some((x.floor() as u32, y.floor() as u32))
}
pub(super) fn sampling(s: &State) -> bool {
    s.color
        .draft
        .as_ref()
        .is_some_and(|d| matches!(d.mode, Mode::Sampling(None)))
}
pub(crate) fn sample_hint(s: &State) -> Option<&str> {
    s.color
        .draft
        .as_ref()
        .filter(|d| matches!(d.mode, Mode::Sampling(None)))
        .map(|d| d.preview_notice.unwrap_or("Click a pixel · Esc to cancel"))
}
pub(super) fn sample_image(s: &State, image: El) -> El {
    if !sampling(s) {
        return image;
    }
    image
        .cursor(rune::Cursor::Crosshair)
        .on_drag(|s: &mut State, drag, _| s.pick_pixel(drag))
}
fn marker(x: f32, y: f32) -> El {
    el().absolute(x - 4., y - 4.)
        .size(8., 8.)
        .radius(4.)
        .border(1., Color::BLACK)
        .child(el().size(6., 6.).radius(3.).border(1.5, Color::WHITE))
        .inert()
}
fn picker_body(s: &State) -> El {
    let d = s.color.draft.as_ref().expect("Open color picker");
    let height = if s.list.viewport[3] > 0. && s.list.viewport[3] < 480. {
        72.
    } else {
        HEIGHT
    };
    let square = el()
        .key("color-square")
        .size(WIDTH, height)
        .pixels(&d.square)
        .radius(2.)
        .role("slider")
        .label("Saturation and brightness")
        .a11y_value(format!(
            "{:.0}% saturation, {:.0}% brightness",
            d.hsv[1] * 100.,
            d.hsv[2] * 100.
        ))
        .help("Left/Right adjust saturation. Up/Down adjust brightness.")
        .focusable(true)
        .cursor(rune::Cursor::Crosshair)
        .on_drag(|s: &mut State, drag, _| {
            if drag.cancelled() {
                return;
            }
            if let Some(d) = &mut s.color.draft {
                d.set_hsv([
                    d.hsv[0],
                    (drag.x / drag.w).clamp(0., 1.),
                    1. - (drag.y / drag.h).clamp(0., 1.),
                ]);
            }
        })
        .on_key(|s: &mut State, event, _| {
            let Some(d) = &mut s.color.draft else {
                return false;
            };
            let mut hsv = d.hsv;
            match event.key {
                Key::Left => hsv[1] -= 0.01,
                Key::Right => hsv[1] += 0.01,
                Key::Up => hsv[2] += 0.01,
                Key::Down => hsv[2] -= 0.01,
                _ => return false,
            }
            hsv[1] = hsv[1].clamp(0., 1.);
            hsv[2] = hsv[2].clamp(0., 1.);
            d.set_hsv(hsv);
            true
        })
        .child(marker(d.hsv[1] * WIDTH, (1. - d.hsv[2]) * height));
    let hue = el()
        .key("color-hue")
        .size(WIDTH, 16.)
        .radius(2.)
        .pixels(&d.hue)
        .role("slider")
        .label("Hue")
        .a11y_value(format!("{:.0} degrees", d.hsv[0] * 360.))
        .help("Arrow keys adjust hue by one degree.")
        .focusable(true)
        .on_drag(|s: &mut State, drag, _| {
            if drag.cancelled() {
                return;
            }
            if let Some(d) = &mut s.color.draft {
                d.set_hsv([(drag.x / drag.w).clamp(0., 1.), d.hsv[1], d.hsv[2]]);
            }
        })
        .on_key(|s: &mut State, event, _| {
            let Some(d) = &mut s.color.draft else {
                return false;
            };
            let delta = match event.key {
                Key::Left | Key::Down => -1. / 360.,
                Key::Right | Key::Up => 1. / 360.,
                _ => return false,
            };
            d.set_hsv([(d.hsv[0] + delta).rem_euclid(1.), d.hsv[1], d.hsv[2]]);
            true
        })
        .child(
            el().absolute((d.hsv[0] * WIDTH - 2.).clamp(0., WIDTH - 4.), -1.)
                .size(4., 18.)
                .radius(1.)
                .border(1., Color::WHITE)
                .inert(),
        );
    let hex_input = input_box(
        text_input(&d.hex, rune::tok::type_::LABEL)
            .key("color-hex")
            .label("Hex color")
            .invalid(parse_hex(&d.hex.text).is_none())
            .on_edit(|s: &mut State| &mut s.color.draft.as_mut().expect("Open picker").hex)
            .on_submit(|s: &mut State, _| s.apply_color()),
        160.,
        false,
    );
    col()
        .w(WIDTH)
        .gap(8.)
        .child(square)
        .child(hue)
        .child(
            row()
                .gap(8.)
                .center_y()
                .child(
                    el().size(26., 26.)
                        .radius(2.)
                        .fill(paint(parse_hex(&d.hex.text).unwrap_or_else(|| rgb(d.hsv))))
                        .border(0.75, line()),
                )
                .child(hex_input)
                .child(icon_button(
                    "color-sample",
                    "Pick color",
                    &EYEDROPPER,
                    |s, _| s.sample_color(),
                )),
        )
        .children(
            (!d.error.is_empty()).then(|| label(&d.error).wrap().color(muted()).role("alert")),
        )
        .child(
            row()
                .gap(8.)
                .w_full()
                .justify_between()
                .child(button("color-cancel", "Cancel", |s, _| s.close_color()))
                .child(
                    button("color-apply", "Apply", |s, _| s.apply_color())
                        .blocked(s.worker.is_io()),
                ),
        )
}
pub(super) fn control(s: &State, id: u64, index: usize, overlays: &mut Vec<El>) -> El {
    let rgb = s
        .fields
        .get(&id)
        .and_then(|f| f.get(index..index + 3))
        .map(|fields| std::array::from_fn(|i| fields[i].text.parse::<u8>().unwrap_or(0)))
        .unwrap_or([0; 3]);
    let trigger = row()
        .key(format!("color-{id}"))
        .role("button")
        .label(format!("Choose color {}", hex(rgb)))
        .focusable(true)
        .h(26.)
        .px(6.)
        .gap(8.)
        .center_y()
        .radius(2.)
        .fill(Color::WHITE)
        .border(0.75, line())
        .hover(rune::oklch(0.96, 0., 0.))
        .on_press(move |s: &mut State| s.open_color(id, index))
        .child(
            el().size(20., 16.)
                .radius(2.)
                .fill(paint(rgb))
                .border(0.75, line()),
        )
        .child(label(hex(rgb)));
    let open = s
        .color
        .draft
        .as_ref()
        .is_some_and(|d| d.target == (id, index) && matches!(d.mode, Mode::Panel));
    let mut popover = Popover::new(format!("color-picker-{id}"))
        .label("Choose color")
        .placement(rune_kit::Placement::BottomStart)
        .trigger(trigger)
        .padding(10.)
        .open(open)
        .on_close(|s: &mut State| s.close_color());
    if open {
        popover = popover.child(picker_body(s));
    }
    col().gap(4.).child(label("Color")).child(
        row()
            .gap(6.)
            .center_y()
            .child(popover.build(&kit(), overlays))
            .child(
                icon_button(
                    format!("eyedropper-{id}"),
                    "Pick color",
                    &EYEDROPPER,
                    move |s, _| {
                        s.open_color(id, index);
                        s.sample_color();
                    },
                )
                .blocked(!cfg!(target_os = "macos") && s.displayed.is_none()),
            ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn color_conversions_and_hex_are_consistent_at_channel_extremes() {
        for red in [0, 1, 127, 128, 254, 255] {
            for green in [0, 1, 127, 128, 254, 255] {
                for blue in [0, 1, 127, 128, 254, 255] {
                    let color = [red, green, blue];
                    assert_eq!(parse_hex(&hex(color)), Some(color));
                    assert_eq!(rgb(hsv(color)), color);
                }
            }
        }
        assert_eq!(parse_hex("  aBc123 "), Some([171, 193, 35]));
        for invalid in ["", "#fff", "#12345678", "#gg0000", "ééé", "red"] {
            assert_eq!(parse_hex(invalid), None);
        }
    }
    #[test]
    fn pixel_mapping_handles_fit_letterboxes_actual_size_and_boundaries() {
        assert_eq!(
            image_pixel([100., 50.], [200., 200.], (100, 50), false),
            Some((50, 0))
        );
        assert_eq!(
            image_pixel([100., 49.], [200., 200.], (100, 50), false),
            None
        );
        assert_eq!(
            image_pixel([200., 150.], [200., 200.], (100, 50), false),
            None
        );
        assert_eq!(
            image_pixel([199.9, 149.9], [200., 200.], (100, 50), false),
            Some((99, 49))
        );
        assert_eq!(
            image_pixel([3.9, 4.9], [100., 50.], (100, 50), true),
            Some((3, 4))
        );
        assert_eq!(image_pixel([-0.1, 4.], [100., 50.], (100, 50), true), None);
    }
}
