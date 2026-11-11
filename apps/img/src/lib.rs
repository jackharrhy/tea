use anyhow::{Context, Result, ensure};
use image::{AnimationDecoder, RgbaImage};
use std::{
    fs::File,
    io::{BufReader, BufWriter, Write},
    path::Path,
};

pub const MAX_BYTES: usize = 256 * 1024 * 1024;
pub const MAX_STACK_BYTES: usize = 1024 * 1024 * 1024;
pub const MAX_DIMENSION: u32 = 4096;
pub const MAX_FRAMES: usize = 1000;
pub const MAX_OPERATIONS: usize = 64;
pub const MAX_DELAY_MS: u32 = u16::MAX as u32 * 10;

#[derive(Clone, Debug)]
pub struct Frame {
    pub pixels: std::sync::Arc<RgbaImage>,
    pub delay_ms: u32,
}
#[derive(Clone, Debug)]
pub struct Animation {
    pub frames: Vec<Frame>,
    pub repeat: gif::Repeat,
}
impl Animation {
    pub fn load_image(path: &Path) -> Result<Self> {
        ensure!(
            path.metadata()?.len() <= 64 * 1024 * 1024,
            "Image file exceeds 64 MiB"
        );
        let mut reader = image::ImageReader::open(path)?.with_guessed_format()?;
        if reader.format() == Some(image::ImageFormat::Gif) {
            return Self::load(path);
        }
        ensure!(
            matches!(
                reader.format(),
                Some(image::ImageFormat::Png | image::ImageFormat::Jpeg)
            ),
            "Choose a GIF, PNG, or JPEG"
        );
        let mut limits = image::Limits::default();
        limits.max_image_width = Some(MAX_DIMENSION);
        limits.max_image_height = Some(MAX_DIMENSION);
        limits.max_alloc = Some(MAX_BYTES as u64);
        reader.limits(limits);
        let animation = Self {
            frames: vec![Frame {
                pixels: reader.decode()?.to_rgba8().into(),
                delay_ms: 100,
            }],
            repeat: gif::Repeat::Infinite,
        };
        animation.validate()?;
        Ok(animation)
    }
    pub fn load(path: &Path) -> Result<Self> {
        ensure!(
            path.metadata()?.len() <= 64 * 1024 * 1024,
            "GIF file exceeds 64 MiB"
        );
        let metadata = gif::DecodeOptions::new().read_info(BufReader::new(File::open(path)?))?;
        let (w, h) = (metadata.width() as u32, metadata.height() as u32);
        dimensions(w, h)?;
        let repeat = metadata.repeat();
        drop(metadata);
        let decoder = image::codecs::gif::GifDecoder::new(BufReader::new(File::open(path)?))?;
        let mut frames = Vec::new();
        for frame in decoder.into_frames() {
            ensure!(frames.len() < MAX_FRAMES, "GIF exceeds {MAX_FRAMES} frames");
            ensure!(
                (frames.len() + 1) * w as usize * h as usize * 4 <= MAX_BYTES,
                "Decoded GIF exceeds 256 MiB"
            );
            let frame = frame.context("Decoding GIF frame")?;
            let (n, d) = frame.delay().numer_denom_ms();
            frames.push(Frame {
                delay_ms: n / d,
                pixels: std::sync::Arc::new(frame.into_buffer()),
            });
        }
        ensure!(!frames.is_empty(), "GIF contains no frames");
        Ok(Self { frames, repeat })
    }
    pub fn save(&self, path: &Path) -> Result<()> {
        self.validate()?;
        let (w, h) = self.frames[0].pixels.dimensions();
        dimensions(w, h)?;
        let parent = path
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or(Path::new("."));
        let mut temp = tempfile::NamedTempFile::new_in(parent)?;
        {
            let mut writer = BufWriter::new(temp.as_file_mut());
            {
                let mut encoder = gif::Encoder::new(&mut writer, w as u16, h as u16, &[])?;
                encoder.set_repeat(self.repeat)?;
                for frame in &self.frames {
                    ensure!(
                        frame.pixels.dimensions() == (w, h),
                        "Inconsistent frame dimensions"
                    );
                    let encoded = palette::encode_frame(&frame.pixels, frame.delay_ms);
                    encoder.write_frame(&encoded)?;
                }
            }
            writer.flush()?;
        }
        temp.persist(path).context("Saving output GIF")?;
        Ok(())
    }
    pub fn validate(&self) -> Result<()> {
        ensure!(
            !self.frames.is_empty() && self.frames.len() <= MAX_FRAMES,
            "Animation must have 1–{MAX_FRAMES} frames"
        );
        let (w, h) = self.frames[0].pixels.dimensions();
        dimensions(w, h)?;
        ensure!(
            self.bytes() <= MAX_BYTES,
            "Decoded animation exceeds 256 MiB"
        );
        for frame in &self.frames {
            ensure!(
                frame.pixels.dimensions() == (w, h),
                "Inconsistent frame dimensions"
            );
            ensure!(
                frame.delay_ms <= MAX_DELAY_MS,
                "Frame delay exceeds GIF's {} ms limit",
                MAX_DELAY_MS
            );
        }
        Ok(())
    }
    pub fn bytes(&self) -> usize {
        self.frames
            .iter()
            .map(|f| f.pixels.as_raw().len())
            .fold(0, usize::saturating_add)
    }
}
pub mod fonts;
mod ops;
mod palette;
pub use ops::{Operation, Parameter, ParameterKind};

#[derive(Clone, Debug, PartialEq)]
pub struct Card {
    pub id: u64,
    pub enabled: bool,
    pub operation: Operation,
}
pub fn process(
    source: std::sync::Arc<Animation>,
    cards: &[Card],
) -> Result<Vec<std::sync::Arc<Animation>>> {
    source.validate()?;
    ensure!(
        cards.len() <= MAX_OPERATIONS,
        "A stack can contain at most {MAX_OPERATIONS} operations"
    );
    let mut current = source.clone();
    let mut seen = std::collections::HashSet::new();
    let mut retained = 0;
    for frame in &current.frames {
        if seen.insert(std::sync::Arc::as_ptr(&frame.pixels)) {
            retained += frame.pixels.as_raw().len();
        }
    }
    let mut outputs = Vec::with_capacity(cards.len());
    for (index, card) in cards.iter().enumerate() {
        if card.enabled {
            let plan = card
                .operation
                .plan(&current)
                .with_context(|| format!("{} (step {})", card.operation.name(), index + 1))?;
            ensure!(
                retained + plan.allocation <= MAX_STACK_BYTES,
                "{} would exceed the 1024 MiB operation stack budget; resize earlier or remove steps",
                card.operation.name()
            );
            let next = card
                .operation
                .apply(&current, &plan)
                .with_context(|| format!("{} (step {})", card.operation.name(), index + 1))?;
            next.validate()?;
            for frame in &next.frames {
                if seen.insert(std::sync::Arc::as_ptr(&frame.pixels)) {
                    retained += frame.pixels.as_raw().len();
                }
            }
            ensure!(
                retained <= MAX_STACK_BYTES,
                "Operation stack exceeds 1024 MiB"
            );
            current = std::sync::Arc::new(next);
        }
        outputs.push(current.clone());
    }
    Ok(outputs)
}

fn dimensions(w: u32, h: u32) -> Result<()> {
    ensure!(
        w > 0 && h > 0 && w <= MAX_DIMENSION && h <= MAX_DIMENSION,
        "Dimensions must be 1–{MAX_DIMENSION}"
    );
    Ok(())
}

mod render;
pub use render::{RenderCache, RenderStats};
