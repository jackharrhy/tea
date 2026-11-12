use anyhow::{Context, Result, ensure};
use image::{Rgba, RgbaImage};
use img::{Animation, Card, Frame, Operation};
use std::sync::Arc;

// SplitMix64: explicit algorithm so a seed replays identically on every platform.
struct Random(u64);
impl Random {
    fn pick(&mut self, count: usize) -> usize {
        self.0 = self.0.wrapping_add(0x9e3779b97f4a7c15);
        let mut value = self.0;
        value = (value ^ (value >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
        value = (value ^ (value >> 27)).wrapping_mul(0x94d049bb133111eb);
        ((value ^ (value >> 31)) % count as u64) as usize
    }

    fn operation(&mut self) -> Operation {
        match self.pick(3) {
            0 => Operation::Reverse,
            1 => Operation::Negate,
            _ => Operation::Resize {
                width: (self.pick(24) + 1) as u32,
                height: (self.pick(18) + 1) as u32,
            },
        }
    }
}

// Uniform frames give an independent exact oracle, including for resize:
// track only dimensions, frame order, and RGB inversion, not image algorithms.
fn verify(
    actual: &Animation,
    colors: &[[u8; 4]],
    delays: &[u32],
    size: (u32, u32),
    repeat: gif::Repeat,
    _exported: bool,
) -> Result<()> {
    ensure!(actual.repeat == repeat, "Loop metadata changed");
    ensure!(actual.frames.len() == colors.len(), "Frame count changed");
    for ((frame, color), delay) in actual.frames.iter().zip(colors).zip(delays) {
        ensure!(frame.pixels.dimensions() == size, "Wrong dimensions");
        ensure!(frame.delay_ms == *delay, "Frame order or timing changed");
        for pixel in frame.pixels.pixels() {
            ensure!(pixel[3] == color[3], "Transparency changed");
            if color[3] != 0 {
                ensure!(
                    pixel.0 == *color,
                    "Wrong color: {:?}, expected {color:?}",
                    pixel.0
                );
            }
        }
    }
    Ok(())
}

fn run_seed(seed: u64, steps: usize, trace: &mut Vec<String>) -> Result<()> {
    let mut random = Random(seed);
    let dir = tempfile::tempdir()?;
    let path = dir.path().join("source.gif");
    let colors: Vec<[u8; 4]> = (0..7)
        .map(|i| {
            [
                random.pick(256) as u8,
                random.pick(256) as u8,
                random.pick(256) as u8,
                if i == 3 { 0 } else { 255 },
            ]
        })
        .collect();
    let source = Animation {
        frames: colors
            .iter()
            .enumerate()
            .map(|(i, color)| Frame {
                pixels: RgbaImage::from_pixel(12, 9, Rgba(*color)).into(),
                delay_ms: (i as u32 + 1) * 30,
            })
            .collect(),
        repeat: if random.pick(2) == 0 {
            gif::Repeat::Infinite
        } else {
            gif::Repeat::Finite(3)
        },
    };
    source.save(&path)?;
    let source = Arc::new(Animation::load(&path)?);
    let mut cards: Vec<Card> = Vec::new();
    let mut next_id = 1;
    for step in 0..steps {
        let action = if cards.is_empty() { 0 } else { random.pick(5) };
        match action {
            0 if cards.len() < 8 => {
                let card = Card {
                    id: next_id,
                    enabled: true,
                    operation: random.operation(),
                };
                trace.push(format!("{step}: add {card:?}"));
                cards.insert(random.pick(cards.len() + 1), card);
                next_id += 1;
            }
            1 => {
                let i = random.pick(cards.len());
                cards[i].enabled = !cards[i].enabled;
                trace.push(format!("{step}: toggle {i}"));
            }
            2 => {
                let from = random.pick(cards.len());
                let card = cards.remove(from);
                let to = random.pick(cards.len() + 1);
                cards.insert(to, card);
                trace.push(format!("{step}: move {from} -> {to}"));
            }
            3 => {
                let i = random.pick(cards.len());
                cards[i].operation = random.operation();
                trace.push(format!("{step}: edit {i} to {:?}", cards[i].operation));
            }
            _ => {
                let i = random.pick(cards.len());
                cards.remove(i);
                trace.push(format!("{step}: remove {i}"));
            }
        }
        let outputs = img::process(source.clone(), &cards).context("Processing stack")?;
        ensure!(outputs.len() == cards.len(), "Missing step previews");
        let mut colors: Vec<_> = source
            .frames
            .iter()
            .map(|f| f.pixels.get_pixel(0, 0).0)
            .collect();
        let mut delays: Vec<_> = source.frames.iter().map(|f| f.delay_ms).collect();
        let mut size = (12, 9);
        for (index, (card, output)) in cards.iter().zip(&outputs).enumerate() {
            if card.enabled {
                match card.operation {
                    Operation::Resize { width, height } => size = (width, height),
                    Operation::Reverse => {
                        colors.reverse();
                        delays.reverse();
                    }
                    Operation::Negate => {
                        for color in &mut colors {
                            for channel in &mut color[..3] {
                                *channel = 255 - *channel;
                            }
                        }
                    }
                    _ => unreachable!("This oracle covers resize, reverse and negate"),
                }
            } else {
                let previous = if index == 0 {
                    &source
                } else {
                    &outputs[index - 1]
                };
                ensure!(
                    Arc::ptr_eq(previous, output),
                    "Bypassed card allocated a new output"
                );
            }
            verify(output, &colors, &delays, size, source.repeat, false)
                .with_context(|| format!("Checking step {index}: {card:?}"))?;
        }
        let final_output = outputs.last().unwrap_or(&source);
        let export = dir.path().join("export.gif");
        final_output.save(&export).context("Exporting result")?;
        let decoded = Animation::load(&export).context("Reopening exported GIF")?;
        verify(&decoded, &colors, &delays, size, source.repeat, true)?;
    }
    Ok(())
}

#[test]
fn seeded_edit_sequences_import_process_export_and_reopen() {
    let seeds = std::env::var("IMG_FUZZ_SEED")
        .map(|s| vec![s.parse().expect("IMG_FUZZ_SEED must be a decimal u64")])
        .unwrap_or_else(|_| vec![1, 7, 42, 99, 20261021, 0xdeadbeef, u64::MAX]);
    let steps = std::env::var("IMG_FUZZ_STEPS")
        .map(|s| {
            s.parse()
                .expect("IMG_FUZZ_STEPS must be a positive integer")
        })
        .unwrap_or(100);
    for seed in seeds {
        let mut trace = Vec::new();
        if let Err(error) = run_seed(seed, steps, &mut trace) {
            panic!(
                "Replay: IMG_FUZZ_SEED={seed} IMG_FUZZ_STEPS={steps} cargo test --test seeded_pipeline -- --nocapture\n{error:#}\n{}",
                trace.join("\n")
            );
        }
    }
}
