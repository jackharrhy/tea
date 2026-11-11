use crate::Animation;
use anyhow::{Result, ensure};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ParameterKind {
    Number,
    Text,
    File,
}
trait Value: std::str::FromStr + ToString {
    const TEXT: bool = false;
    const INTEGER: bool = true;
    fn check(&self, label: &str, min: f64, max: f64) -> Result<()>;
}
macro_rules! number_values {($($t:ty),*)=>{$(impl Value for $t {fn check(&self,label:&str,min:f64,max:f64)->Result<()>{check(*self as f64,label,min,max)}})*}}
number_values!(u8, u32, i32);
impl Value for f32 {
    const INTEGER: bool = false;
    fn check(&self, label: &str, min: f64, max: f64) -> Result<()> {
        check(*self as f64, label, min, max)
    }
}
impl Value for String {
    const TEXT: bool = true;
    fn check(&self, label: &str, min: f64, max: f64) -> Result<()> {
        ensure!(
            !self.contains('\0'),
            "{label} cannot contain a null character"
        );
        let count = self.chars().count() as f64;
        ensure!(
            (min..=max).contains(&count),
            "{label} must contain at most {max} characters"
        );
        Ok(())
    }
}
#[derive(Clone, Debug)]
pub struct Parameter {
    pub key: &'static str,
    pub label: &'static str,
    pub value: String,
    pub min: f64,
    pub max: f64,
    pub kind: ParameterKind,
    pub integer: bool,
}

macro_rules! catalog {
    ($($variant:ident $({$($field:ident: $ty:ty = $default:expr => ($label:literal, $min:expr, $max:expr)),* $(,)?})? => ($name:literal, $category:literal, $description:literal);)*) => {
        #[derive(Clone, Debug, PartialEq)]
        pub enum Operation { $($variant $({$($field: $ty),*})?,)* }
        impl Operation {
            pub fn id(&self) -> &'static str { match self { $(Self::$variant $({$($field: _),*})? => stringify!($variant),)* } }
            pub fn name(&self) -> &'static str { match self { $(Self::$variant $({$($field: _),*})? => $name,)* } }
            pub fn category(&self) -> &'static str { match self { $(Self::$variant $({$($field: _),*})? => $category,)* } }
            pub fn description(&self) -> &'static str { match self { $(Self::$variant $({$($field: _),*})? => $description,)* } }
            pub fn parameters(&self) -> Vec<Parameter> {
                match self { $(Self::$variant $({$($field),*})? => vec![$($(Parameter {key: stringify!($field), label: $label, value: $field.to_string(), integer: <$ty as Value>::INTEGER, kind: if <$ty as Value>::TEXT { if stringify!($field)=="path" {ParameterKind::File}else{ParameterKind::Text} }else{ParameterKind::Number}, min: $min as f64, max: $max as f64}),*)?],)* }
            }
            pub fn with_parameters(&self, values: &[String]) -> Result<Self> {
                ensure!(values.len() == self.parameters().len(), "Incorrect number of parameters for {}", self.name());
                let mut values = values.iter();
                let operation = match self { $(Self::$variant $({$($field: _),*})? => Self::$variant $({$($field: parse::<$ty>(values.next().expect("Checked parameter count"), $label, $min as f64, $max as f64)?),*})?,)* };
                ensure!(values.next().is_none(), "Unexpected parameter");
                Ok(operation)
            }
            pub(super) fn validate_parameters(&self) -> Result<()> {
                match self { $(Self::$variant $({$($field),*})? => {$($(<$ty as Value>::check($field,$label,$min as f64,$max as f64)?;)*)?},)* }
                Ok(())
            }
            pub fn catalog() -> Vec<Self> { vec![$(Self::$variant $({$($field: $default),*})?,)*] }
        }
    }
}
fn check(value: f64, label: &str, min: f64, max: f64) -> Result<()> {
    ensure!(
        value.is_finite() && (min..=max).contains(&value),
        "{label} must be from {min} to {max}"
    );
    Ok(())
}
fn parse<T: Value>(text: &str, label: &str, min: f64, max: f64) -> Result<T> {
    let text = if T::TEXT { text } else { text.trim() };
    let value: T = text
        .parse()
        .map_err(|_| anyhow::anyhow!("Invalid value for {label}: {text}"))?;
    value.check(label, min, max)?;
    Ok(value)
}

catalog! {
    Resize { width: u32 = 320 => ("Width (px)", 1, 4096), height: u32 = 240 => ("Height (px)", 1, 4096) } => ("Resize", "Size & shape", "Set width and height independently.");
    Fit { width: u32 = 320 => ("Max width (px)", 1, 4096), height: u32 = 240 => ("Max height (px)", 1, 4096) } => ("Fit inside box", "Size & shape", "Resize within a box, keeping the aspect ratio.");
    Fill { width: u32 = 320 => ("Width (px)", 1, 4096), height: u32 = 240 => ("Height (px)", 1, 4096) } => ("Fill and crop", "Size & shape", "Fill a box, keeping the aspect ratio; crop the excess from the center.");
    Crop { x: u32 = 0 => ("Left (px)", 0, 4095), y: u32 = 0 => ("Top (px)", 0, 4095), width: u32 = 160 => ("Width (px)", 1, 4096), height: u32 = 120 => ("Height (px)", 1, 4096) } => ("Crop", "Size & shape", "Keep a rectangle inside every frame.");
    Canvas { width: u32 = 480 => ("Width (px)", 1, 4096), height: u32 = 360 => ("Height (px)", 1, 4096) } => ("Canvas size", "Size & shape", "Center frames on a transparent canvas; a smaller canvas crops them.");
    Border { pixels: u32 = 8 => ("Width (px)", 0, 2048), red: u8 = 255 => ("Red", 0, 255), green: u8 = 255 => ("Green", 0, 255), blue: u8 = 255 => ("Blue", 0, 255) } => ("Solid border", "Size & shape", "Add a solid border around every frame.");
    Rotate { degrees: f32 = 15.0 => ("Angle (degrees)", -360, 360) } => ("Rotate", "Size & shape", "Rotate clockwise on an expanded transparent canvas.");
    Rotate90 => ("Rotate 90° clockwise", "Size & shape", "Turn every frame a quarter turn clockwise.");
    Rotate180 => ("Rotate 180°", "Size & shape", "Turn every frame upside down.");
    Rotate270 => ("Rotate 90° counterclockwise", "Size & shape", "Turn every frame a quarter turn counterclockwise.");
    FlipHorizontal => ("Flip horizontally", "Size & shape", "Mirror left and right.");
    FlipVertical => ("Flip vertically", "Size & shape", "Mirror top and bottom.");
    Transpose => ("Transpose", "Size & shape", "Reflect across the top-left to bottom-right diagonal.");
    Roll { x: i32 = 16 => ("Horizontal shift (px)", -4096, 4096), y: i32 = 0 => ("Vertical shift (px)", -4096, 4096) } => ("Wraparound shift", "Size & shape", "Move pixels with wraparound at the edges.");
    TrimTransparent => ("Trim transparent edges", "Size & shape", "Use the union of visible content across all frames, keeping the animation aligned.");
    Reverse => ("Reverse", "Animation", "Reverse the frame order.");
    Speed { percent: f32 = 200.0 => ("Speed (%)", 1, 10000) } => ("Speed", "Animation", "100% keeps the speed; 200% plays twice as fast.");
    SetDelay { milliseconds: u32 = 100 => ("Delay (ms)", 0, 655350) } => ("Set frame delay", "Animation", "Give every frame the same delay.");
    FrameRate { fps: u32 = 15 => ("Frames per second", 1, 100) } => ("Set frame rate", "Animation", "Retime the existing frames; distribute GIF's 10 ms timing steps evenly.");
    TrimFrames { first: u32 = 1 => ("First frame", 1, 1000), last: u32 = 10 => ("Last frame", 1, 1000) } => ("Trim frame range", "Animation", "Keep a range of frames, including both endpoints.");
    KeepEvery { step: u32 = 2 => ("Keep every Nth frame", 1, 1000) } => ("Reduce frame count", "Animation", "Keep the first and every Nth frame; add skipped delays to preserve duration.");
    PingPong => ("Ping-pong", "Animation", "Play forward, then backward, without repeating the endpoint frames.");
    RepeatFrames { times: u32 = 2 => ("Copies", 1, 1000) } => ("Repeat sequence", "Animation", "Concatenate copies of the frame sequence.");
    LoopCount { plays: u32 = 0 => ("Plays (0 = forever)", 0, 65536) } => ("Loop count", "Animation", "Set playback metadata. The editor's preview continues to loop.");
    HoldFirst { milliseconds: u32 = 500 => ("Extra hold (ms)", 0, 655350) } => ("Hold first frame", "Animation", "Add a pause at the beginning.");
    HoldLast { milliseconds: u32 = 500 => ("Extra hold (ms)", 0, 655350) } => ("Hold last frame", "Animation", "Add a pause at the end.");
    ShiftFrames { offset: u32 = 1 => ("Start at frame", 1, 1000) } => ("Shift starting frame", "Animation", "Choose the first frame; wrap the preceding frames to the end.");
    RemoveDuplicates => ("Merge duplicate frames", "Animation", "Merge identical consecutive frames while preserving their combined delay.");
    Negate => ("Negate", "Color", "Invert colors.");
    Grayscale => ("Grayscale", "Color", "Convert colors to luminance.");
    Sepia => ("Sepia", "Color", "Apply a warm sepia tone.");
    Brightness { amount: i32 = 20 => ("Amount", -255, 255) } => ("Brightness", "Color", "Add or subtract from the RGB channels.");
    Contrast { amount: f32 = 20.0 => ("Amount (%)", -100, 100) } => ("Contrast", "Color", "Expand or compress color values around mid-gray.");
    Gamma { gamma: f32 = 1.2 => ("Gamma", 0.1, 5) } => ("Gamma", "Color", "Adjust midtones; values above 1 brighten them.");
    Saturation { percent: f32 = 150.0 => ("Saturation (%)", 0, 400) } => ("Saturation", "Color", "100% keeps the colors; 0% removes saturation.");
    Hue { degrees: f32 = 30.0 => ("Hue shift (degrees)", -360, 360) } => ("Hue", "Color", "Rotate hue around the color wheel.");
    Exposure { stops: f32 = 1.0 => ("Exposure (stops)", -5, 5) } => ("Exposure", "Color", "Adjust exposure in linear light; +1 stop doubles the light.");
    ColorBalance { red: i32 = 10 => ("Red offset", -255, 255), green: i32 = 0 => ("Green offset", -255, 255), blue: i32 = -10 => ("Blue offset", -255, 255) } => ("Color balance", "Color", "Adjust each RGB channel independently.");
    ColorTint { red: u8 = 255 => ("Red", 0, 255), green: u8 = 180 => ("Green", 0, 255), blue: u8 = 80 => ("Blue", 0, 255), percent: f32 = 25.0 => ("Strength (%)", 0, 100) } => ("Color tint", "Color", "Blend a solid color into the image.");
    Threshold { level: u8 = 128 => ("Threshold", 0, 255) } => ("Black and white", "Color", "Turn luminance into black or white at a threshold.");
    Posterize { levels: u32 = 4 => ("Levels per channel", 2, 256) } => ("Posterize", "Color", "Reduce the number of color levels in each channel.");
    Solarize { threshold: u8 = 128 => ("Threshold", 0, 255) } => ("Solarize", "Color", "Invert channel values above the threshold.");
    AutoLevels => ("Auto levels", "Color", "Stretch each channel using visible colors across the whole animation to avoid frame-to-frame flicker.");
    Opacity { percent: f32 = 50.0 => ("Opacity (%)", 0, 100) } => ("Opacity", "Transparency", "Scale alpha. Add Matte to bake partial opacity into GIF colors; GIF alone has binary transparency.");
    Matte { red: u8 = 255 => ("Red", 0, 255), green: u8 = 255 => ("Green", 0, 255), blue: u8 = 255 => ("Blue", 0, 255) } => ("Matte background", "Transparency", "Flatten transparency onto a solid color.");
    ColorKey { red: u8 = 255 => ("Red", 0, 255), green: u8 = 255 => ("Green", 0, 255), blue: u8 = 255 => ("Blue", 0, 255), tolerance: u8 = 16 => ("Color tolerance", 0, 255) } => ("Color to transparency", "Transparency", "Make matching colors transparent; tolerance is the maximum difference in any RGB channel.");
    AlphaThreshold { level: u8 = 128 => ("Alpha threshold", 0, 255) } => ("Threshold transparency", "Transparency", "Turn partial alpha into fully transparent or opaque pixels.");
    AlphaMask => ("Show alpha mask", "Transparency", "Show alpha as an opaque grayscale image.");
    FadeIn { frames: u32 = 8 => ("Fade frames", 1, 1000), red: u8 = 0 => ("Red", 0, 255), green: u8 = 0 => ("Green", 0, 255), blue: u8 = 0 => ("Blue", 0, 255) } => ("Fade in", "Animation", "Blend the opening frames from a solid color, preserving alpha.");
    FadeOut { frames: u32 = 8 => ("Fade frames", 1, 1000), red: u8 = 0 => ("Red", 0, 255), green: u8 = 0 => ("Green", 0, 255), blue: u8 = 0 => ("Blue", 0, 255) } => ("Fade out", "Animation", "Blend the closing frames toward a solid color, preserving alpha.");
    Blur { sigma: f32 = 1.5 => ("Radius (sigma)", 0.1, 20) } => ("Gaussian blur", "Effects", "Blur in premultiplied alpha to avoid dark transparent edges.");
    Sharpen { sigma: f32 = 1.0 => ("Radius (sigma)", 0.1, 10), threshold: i32 = 3 => ("Threshold", 0, 255) } => ("Sharpen", "Effects", "Apply an unsharp mask without changing alpha.");
    Pixelate { block: u32 = 8 => ("Block size (px)", 1, 256) } => ("Pixelate", "Effects", "Reduce resolution and scale back with nearest-neighbor sampling.");
    Edges => ("Detect edges", "Effects", "Show Sobel luminance edges on black.");
    Emboss { strength: f32 = 1.0 => ("Strength", 0, 5) } => ("Emboss", "Effects", "Shade directional differences around mid-gray.");
    Noise { amount: u32 = 20 => ("Amount", 0, 255), seed: u32 = 1 => ("Seed", 0, 4294967295u64) } => ("Add noise", "Effects", "Add reproducible RGB noise; the same seed gives the same result.");
    OrderedDither { levels: u32 = 3 => ("Levels per channel", 2, 6) } => ("Ordered dither", "Effects", "Reduce colors with a stable 4×4 Bayer pattern.");
    Dither { levels: u32 = 3 => ("Levels per channel", 2, 6) } => ("Error diffusion dither", "Effects", "Reduce colors with Floyd–Steinberg error diffusion.");
    Vignette { percent: f32 = 60.0 => ("Strength (%)", 0, 100) } => ("Vignette", "Effects", "Darken the corners with a soft radial falloff.");
    Scanlines { spacing: u32 = 3 => ("Line spacing (px)", 2, 64), percent: f32 = 40.0 => ("Darkening (%)", 0, 100) } => ("Scanlines", "Effects", "Darken evenly spaced horizontal rows.");
    Swirl { degrees: f32 = 120.0 => ("Twist (degrees)", -720, 720) } => ("Swirl", "Effects", "Twist around the center, fading the distortion toward the edges.");
    Wave { amplitude: f32 = 8.0 => ("Amplitude (px)", 0, 256), wavelength: f32 = 80.0 => ("Wavelength (px)", 1, 4096) } => ("Wave", "Effects", "Shift rows in a sine wave on the existing canvas; exposed pixels are transparent.");
    Quantize { colors: u32 = 64 => ("Palette colors", 2, 256) } => ("Limit palette", "Color", "Map all frames to a shared palette while preserving alpha.");
    RoundCorners { radius: u32 = 16 => ("Corner radius (px)", 0, 2048) } => ("Round corners", "Transparency", "Mask the corners with antialiased transparency.");
    Text { text: String = "Text".into() => ("Caption", 0, 1000), x: i32 = 16 => ("Left (px)", -4096, 4096), y: i32 = 16 => ("Top (px)", -4096, 4096), size: u32 = 24 => ("Font size (px)", 8, 256), red: u8 = 255 => ("Red", 0, 255), green: u8 = 255 => ("Green", 0, 255), blue: u8 = 255 => ("Blue", 0, 255), outline: u32 = 1 => ("Black outline (px)", 0, 8), font: String = String::new() => ("Font", 0, 256), tracking: f32 = 0. => ("Letter spacing (px)", -8, 32), leading: f32 = 100. => ("Line spacing (%)", 50, 300), align: u32 = 0 => ("Line alignment", 0, 2) } => ("Text caption", "Overlay", "Draw text using bundled or installed fonts. Shift+Enter adds a line.");
    Overlay { path: String = String::new() => ("Image file", 0, 4096), x: i32 = 0 => ("Left (px)", -4096, 4096), y: i32 = 0 => ("Top (px)", -4096, 4096), width: u32 = 0 => ("Width (0 = original)", 0, 4096), percent: f32 = 100.0 => ("Opacity (%)", 0, 100) } => ("Image / GIF overlay", "Overlay", "Choose a PNG, JPEG, or GIF. Merge animation timing; overlays repeat over the source duration.");

}

impl Operation {
    pub fn has_preview_handles(&self) -> bool {
        matches!(
            self,
            Self::Text { .. }
                | Self::Rotate { .. }
                | Self::Resize { .. }
                | Self::Fit { .. }
                | Self::Fill { .. }
                | Self::Canvas { .. }
                | Self::Roll { .. }
                | Self::Crop { .. }
        )
    }
    pub fn defaults_for(mut self, source: &Animation) -> Self {
        let (w, h) = source
            .frames
            .first()
            .map_or((320, 240), |f| f.pixels.dimensions());
        let n = (source.frames.len() as u32).max(1);
        match &mut self {
            Self::Crop {
                x,
                y,
                width,
                height,
            } => {
                *x = 0;
                *y = 0;
                *width = w;
                *height = h;
            }
            Self::Canvas { width, height } => {
                *width = w.saturating_add(32).min(4096);
                *height = h.saturating_add(32).min(4096);
            }
            Self::Border { pixels, .. } => {
                *pixels = (*pixels).min((4096 - w) / 2).min((4096 - h) / 2)
            }
            Self::TrimFrames { last, .. } => *last = n,
            Self::FadeIn { frames, .. } | Self::FadeOut { frames, .. } => {
                *frames = (*frames).min(n)
            }
            Self::Resize { width, height }
            | Self::Fit { width, height }
            | Self::Fill { width, height } => {
                while *width as u64 * *height as u64 * n as u64 * 4 > crate::MAX_BYTES as u64 / 2 {
                    *width = (*width / 2).max(1);
                    *height = (*height / 2).max(1);
                }
            }
            Self::Rotate { degrees } if w.max(h) > 2800 => *degrees = 0.,
            Self::Text { x, y, size, .. } => {
                *x = (w / 8).min(16) as i32;
                *y = (h / 8).min(16) as i32;
                *size = (h / 3).clamp(8, 24);
            }
            _ => {}
        }
        self
    }
}
