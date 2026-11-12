use image::{Rgba, RgbaImage};
use img::{Animation, Card, Frame, Operation, RenderCache};
use std::sync::Arc;
fn source() -> Arc<Animation> {
    Arc::new(Animation {
        frames: (0..3)
            .map(|i| Frame {
                pixels: RgbaImage::from_fn(9, 7, |x, y| {
                    Rgba([(x * 23) as u8, (y * 31) as u8, i * 70, ((x + y) * 17) as u8])
                })
                .into(),
                delay_ms: 30 + i as u32 * 20,
            })
            .collect(),
        repeat: gif::Repeat::Finite(2),
    })
}
fn cards() -> Vec<Card> {
    [
        Operation::Gamma { gamma: 1.4 },
        Operation::Negate,
        Operation::Exposure { stops: -0.5 },
        Operation::Grayscale,
        Operation::Brightness { amount: 14 },
        Operation::Opacity { percent: 70. },
        Operation::Posterize { levels: 6 },
        Operation::Reverse,
    ]
    .into_iter()
    .enumerate()
    .map(|(i, operation)| Card {
        id: i as u64,
        enabled: true,
        operation,
    })
    .collect()
}
fn same(a: &Animation, b: &Animation) {
    assert_eq!(a.repeat, b.repeat);
    assert_eq!(a.frames.len(), b.frames.len());
    for (a, b) in a.frames.iter().zip(&b.frames) {
        assert_eq!(a.delay_ms, b.delay_ms);
        assert_eq!(a.pixels, b.pixels);
    }
}
#[test]
fn selected_boundaries_and_final_are_exact_and_unrequested_outputs_are_released() {
    let source = source();
    let cards = cards();
    let reference = img::process(source.clone(), &cards).unwrap();
    for selected in 0..cards.len() {
        let result = RenderCache::default()
            .render(source.clone(), &cards, Some(selected), None)
            .unwrap();
        same(result.last().unwrap(), reference.last().unwrap());
        same(result.get(selected).unwrap(), &reference[selected]);
        assert!(result.stats.fused_operations >= 2);
        assert!(result.retained_bytes() <= source.bytes() * 4);
        for i in 0..cards.len() {
            assert_eq!(
                result.get(i).is_some(),
                i == selected || i + 2 >= cards.len()
            );
        }
    }
}
#[test]
fn append_and_last_edit_reuse_the_unchanged_prefix_and_missing_previews_recompute() {
    let source = source();
    let mut cards = cards();
    let first = RenderCache::default()
        .render(source.clone(), &cards, None, None)
        .unwrap();
    let final_before = first.last().unwrap().clone();
    let selected = first.render(source.clone(), &cards, Some(1), None).unwrap();
    assert!(Arc::ptr_eq(&final_before, selected.last().unwrap()));
    same(
        selected.get(1).unwrap(),
        &img::process(source.clone(), &cards[..2]).unwrap()[1],
    );
    cards.push(Card {
        id: 99,
        enabled: true,
        operation: Operation::Negate,
    });
    let appended = selected.render(source.clone(), &cards, None, None).unwrap();
    assert_eq!(appended.stats.reused_steps, cards.len() - 1);
    assert_eq!(appended.stats.passes, 1);
    cards.last_mut().unwrap().operation = Operation::Brightness { amount: 20 };
    let edited = appended.render(source.clone(), &cards, None, None).unwrap();
    assert_eq!(edited.stats.reused_steps, cards.len() - 1);
    assert_eq!(edited.stats.passes, 1);
    same(
        edited.last().unwrap(),
        img::process(source.clone(), &cards)
            .unwrap()
            .last()
            .unwrap(),
    );
    cards[2].enabled = false;
    let middle = edited.render(source.clone(), &cards, None, None).unwrap();
    assert!(middle.stats.reused_steps <= 2);
    same(
        middle.last().unwrap(),
        img::process(source, &cards).unwrap().last().unwrap(),
    );
}
#[test]
fn source_identity_and_disabled_invalid_operations_are_respected() {
    let source = source();
    let mut cards = cards();
    cards.insert(
        1,
        Card {
            id: 90,
            enabled: false,
            operation: Operation::Posterize { levels: 0 },
        },
    );
    let first = RenderCache::default()
        .render(source.clone(), &cards, None, None)
        .unwrap();
    let mut other = source.as_ref().clone();
    other.frames[0].pixels = RgbaImage::from_pixel(9, 7, Rgba([255, 0, 0, 255])).into();
    let other = Arc::new(other);
    assert!(!first.matches(&other, &cards));
    let next = first.render(other.clone(), &cards, None, None).unwrap();
    assert_eq!(next.stats.reused_steps, 0);
    same(
        next.last().unwrap(),
        img::process(other, &cards).unwrap().last().unwrap(),
    );
    cards[1].enabled = true;
    assert!(next.render(source, &cards, None, None).is_err());
}
#[test]
fn same_overlay_filename_is_reloaded_after_asset_changes() {
    let source = source();
    let temp = tempfile::tempdir().unwrap();
    let asset = temp.path().join("overlay.png");
    let mut cards = cards();
    cards.push(Card {
        id: 99,
        enabled: true,
        operation: Operation::Overlay {
            path: asset.to_str().unwrap().into(),
            x: 0,
            y: 0,
            width: 0,
            percent: 100.,
        },
    });
    RgbaImage::from_pixel(1, 1, Rgba([255, 0, 0, 255]))
        .save(&asset)
        .unwrap();
    let first = RenderCache::default()
        .render(source.clone(), &cards, None, None)
        .unwrap();
    assert_eq!(
        first.last().unwrap().frames[0].pixels.get_pixel(0, 0).0,
        [255, 0, 0, 255]
    );
    RgbaImage::from_pixel(1, 1, Rgba([0, 255, 0, 255]))
        .save(&asset)
        .unwrap();
    let next = first.render(source, &cards, None, None).unwrap();
    assert_eq!(
        next.last().unwrap().frames[0].pixels.get_pixel(0, 0).0,
        [0, 255, 0, 255]
    );
    assert_eq!(next.stats.passes, 1);
}
