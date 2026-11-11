use image::{Rgba, RgbaImage};
use img::{Animation, Card, Frame, Operation};
use std::{collections::HashSet, sync::Arc};

struct Random(u64);
impl Random {
    fn pick(&mut self, n: usize) -> usize {
        self.0 = self.0.wrapping_add(0x9e3779b97f4a7c15);
        let mut x = self.0;
        x = (x ^ (x >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
        x = (x ^ (x >> 27)).wrapping_mul(0x94d049bb133111eb);
        ((x ^ (x >> 31)) % n as u64) as usize
    }
}
fn bounded(op: Operation, current: &Animation, rng: &mut Random, asset: &str) -> Operation {
    use Operation::*;
    let op = op.defaults_for(current);
    let (w, h) = current.frames[0].pixels.dimensions();
    let n = current.frames.len() as u32;
    match op {
        Resize { .. } => Resize {
            width: 8 + rng.pick(25) as u32,
            height: 8 + rng.pick(25) as u32,
        },
        Fit { .. } => Fit {
            width: 32,
            height: 24,
        },
        Fill { .. } => Fill {
            width: 24,
            height: 32,
        },
        Canvas { .. } => Canvas {
            width: 32,
            height: 24,
        },
        Crop { .. } => Crop {
            x: w / 4,
            y: h / 4,
            width: (w / 2).max(1),
            height: (h / 2).max(1),
        },
        Border { .. } => Border {
            pixels: rng.pick(4) as u32,
            red: 17,
            green: 83,
            blue: 200,
        },
        Speed { .. } => Speed {
            percent: (50 + rng.pick(151)) as f32,
        },
        SetDelay { .. } => SetDelay {
            milliseconds: 20 + rng.pick(20) as u32 * 10,
        },
        HoldFirst { .. } => HoldFirst { milliseconds: 50 },
        HoldLast { .. } => HoldLast { milliseconds: 70 },
        RepeatFrames { .. } => RepeatFrames { times: 2 },
        ShiftFrames { .. } => ShiftFrames {
            offset: 1 + rng.pick(n as usize) as u32,
        },
        TrimFrames { .. } => TrimFrames {
            first: 1,
            last: n.div_ceil(2),
        },
        Noise { .. } => Noise {
            amount: 40,
            seed: rng.pick(u32::MAX as usize) as u32,
        },
        Text { .. } => Text {
            text: format!("Seed {}\nimg", rng.pick(100)),
            x: -2,
            y: 1,
            size: 12,
            red: 255,
            green: 255,
            blue: 255,
            outline: 1,
            font: String::new(),
            tracking: 0.,
            leading: 100.,
            align: 0,
        },
        Overlay { .. } => Overlay {
            path: asset.into(),
            x: -1,
            y: 2,
            width: 5,
            percent: 70.,
        },
        other => other,
    }
}
fn assert_same(a: &Animation, b: &Animation) {
    assert_eq!(a.repeat, b.repeat);
    assert_eq!(a.frames.len(), b.frames.len());
    for (a, b) in a.frames.iter().zip(&b.frames) {
        assert_eq!(a.delay_ms, b.delay_ms);
        assert_eq!(a.pixels, b.pixels);
    }
}
fn run(seed: u64, cycles: usize, trace: &mut Vec<String>) {
    let mut rng = Random(seed);
    let temp = tempfile::tempdir().unwrap();
    let asset = temp.path().join("overlay.png");
    RgbaImage::from_fn(3, 2, |x, y| {
        Rgba([255, 20, 30, if x == y { 0 } else { 180 }])
    })
    .save(&asset)
    .unwrap();
    let source = Arc::new(Animation {
        frames: (0..4)
            .map(|i| Frame {
                pixels: RgbaImage::from_fn(13, 11, |x, y| {
                    Rgba([
                        (x * 17 + i * 13) as u8,
                        (y * 19) as u8,
                        (x * y + i * 21) as u8,
                        if (x + y + i) % 5 == 0 { 0 } else { 255 },
                    ])
                })
                .into(),
                delay_ms: 30 + i * 20,
            })
            .collect(),
        repeat: gif::Repeat::Finite(3),
    });
    let original = source.as_ref().clone();
    let mut covered = HashSet::new();
    let mut cards = vec![];
    let mut current = source.clone();
    let mut optimized = img::RenderCache::default();
    for cycle in 0..cycles {
        let mut catalog = Operation::catalog();
        for i in (1..catalog.len()).rev() {
            catalog.swap(i, rng.pick(i + 1));
        }
        for factory in catalog {
            if cards.len() == 6 || current.frames.len() > 32 {
                cards.clear();
                current = source.clone();
            }
            let operation = bounded(factory, &current, &mut rng, asset.to_str().unwrap());
            covered.insert(operation.id());
            trace.push(format!(
                "cycle {cycle}, card {}: {operation:?}",
                cards.len()
            ));
            cards.push(Card {
                id: trace.len() as u64,
                enabled: true,
                operation,
            });
            let outputs = img::process(source.clone(), &cards).unwrap();
            current = outputs.last().unwrap().clone();
            current.validate().unwrap();
            assert_same(&source, &original);
            cards.last_mut().unwrap().enabled = false;
            let bypassed = img::process(source.clone(), &cards).unwrap();
            let previous = if bypassed.len() == 1 {
                &source
            } else {
                &bypassed[bypassed.len() - 2]
            };
            assert!(Arc::ptr_eq(previous, bypassed.last().unwrap()));
            cards.last_mut().unwrap().enabled = true;
            let rerun = img::process(source.clone(), &cards).unwrap();
            for (a, b) in outputs.iter().zip(&rerun) {
                assert_same(a, b);
            }
            let preview = rng.pick(cards.len());
            optimized = optimized
                .render(source.clone(), &cards, Some(preview), None)
                .unwrap();
            assert_same(optimized.last().unwrap(), &current);
            assert_same(optimized.get(preview).unwrap(), &outputs[preview]);
            let path = temp.path().join("result.gif");
            current.save(&path).unwrap();
            let decoded = Animation::load(&path).unwrap();
            assert_eq!(decoded.repeat, current.repeat);
            assert_eq!(decoded.frames.len(), current.frames.len());
            for (a, b) in decoded.frames.iter().zip(&current.frames) {
                assert_eq!(a.pixels.dimensions(), b.pixels.dimensions());
                assert_eq!(a.delay_ms, b.delay_ms.saturating_add(5) / 10 * 10);
                for (a, b) in a.pixels.pixels().zip(b.pixels.pixels()) {
                    assert_eq!(a[3] == 0, b[3] == 0, "GIF changed transparent coverage");
                }
            }
        }
    }
    assert_eq!(covered.len(), Operation::catalog().len());
}
#[test]
fn seeded_mixed_stacks_cover_the_entire_catalog_and_export_after_every_addition() {
    let seeds = std::env::var("IMG_CATALOG_SEED")
        .map(|s| vec![s.parse().unwrap()])
        .unwrap_or_else(|_| vec![1, 42, 0xdeadbeef, u64::MAX]);
    let cycles = std::env::var("IMG_CATALOG_CYCLES")
        .map(|s| s.parse().unwrap())
        .unwrap_or(2);
    for seed in seeds {
        let mut trace = vec![];
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            run(seed, cycles, &mut trace)
        }));
        if let Err(error) = result {
            eprintln!(
                "Replay: IMG_CATALOG_SEED={seed} IMG_CATALOG_CYCLES={cycles} cargo test --test seeded_operations -- --nocapture\n{}",
                trace.join("\n")
            );
            std::panic::resume_unwind(error);
        }
    }
}
