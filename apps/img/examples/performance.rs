use img::{Animation, Card, Operation, RenderCache};
use std::{path::Path, sync::Arc, time::Instant};
fn same(a: &Animation, b: &Animation) {
    assert_eq!(a.repeat, b.repeat);
    for (a, b) in a.frames.iter().zip(&b.frames) {
        assert_eq!(a.delay_ms, b.delay_ms);
        assert_eq!(a.pixels, b.pixels);
    }
    assert_eq!(a.frames.len(), b.frames.len());
}
fn main() -> anyhow::Result<()> {
    let source = Arc::new(Animation::load(Path::new("samples/hummingbird.gif"))?);
    let operations = [
        Operation::Gamma { gamma: 1.2 },
        Operation::Exposure { stops: -0.2 },
        Operation::Brightness { amount: 5 },
        Operation::Contrast { amount: 5. },
        Operation::Negate,
        Operation::ColorTint {
            red: 40,
            green: 180,
            blue: 220,
            percent: 10.,
        },
    ];
    let mut cards: Vec<_> = (0..24)
        .map(|i| Card {
            id: i as u64,
            enabled: true,
            operation: operations[i % operations.len()].clone(),
        })
        .collect();
    let started = Instant::now();
    let reference = img::process(source.clone(), &cards)?;
    let baseline_ms = started.elapsed().as_secs_f64() * 1000.;
    let expected = reference.last().unwrap().clone();
    let baseline_bytes = source.bytes() + reference.iter().map(|a| a.bytes()).sum::<usize>();
    drop(reference);
    let started = Instant::now();
    let cache =
        RenderCache::default().render(source.clone(), &cards, None, Some(expected.clone()))?;
    let cold_ms = started.elapsed().as_secs_f64() * 1000.;
    same(cache.last().unwrap(), &expected);
    println!(
        "24 compatible color effects, {} frames at {}×{}",
        source.frames.len(),
        source.frames[0].pixels.width(),
        source.frames[0].pixels.height()
    );
    println!(
        "Cold: {baseline_ms:.2} ms → {cold_ms:.2} ms ({:.1}×); {} execution passes",
        baseline_ms / cold_ms,
        cache.stats.passes
    );
    println!(
        "Retained pixels: {:.1} MiB → {:.1} MiB ({:.1}× less)",
        baseline_bytes as f64 / 1048576.,
        cache.retained_bytes() as f64 / 1048576.,
        baseline_bytes as f64 / cache.retained_bytes() as f64
    );
    cards.push(Card {
        id: 24,
        enabled: true,
        operation: Operation::Gamma { gamma: 0.9 },
    });
    let started = Instant::now();
    let appended = cache.render(source.clone(), &cards, None, None)?;
    let append_ms = started.elapsed().as_secs_f64() * 1000.;
    println!(
        "Append: {append_ms:.2} ms; {} steps reused, {} pass",
        appended.stats.reused_steps, appended.stats.passes
    );
    cards.last_mut().unwrap().operation = Operation::Exposure { stops: 0.3 };
    let started = Instant::now();
    let edited = appended.render(source.clone(), &cards, None, None)?;
    let edit_ms = started.elapsed().as_secs_f64() * 1000.;
    println!(
        "Last edit: {edit_ms:.2} ms; {} steps reused, {} pass",
        edited.stats.reused_steps, edited.stats.passes
    );
    same(
        edited.last().unwrap(),
        img::process(source, &cards)?.last().unwrap(),
    );
    Ok(())
}
