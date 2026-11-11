use crate::{Animation, Card, MAX_OPERATIONS, MAX_STACK_BYTES, ops::lut::Lookup};
use anyhow::{Context, Result, ensure};
use std::{collections::HashSet, sync::Arc};

#[derive(Clone, Copy, Debug, Default)]
pub struct RenderStats {
    pub passes: usize,
    pub reused_steps: usize,
    pub fused_operations: usize,
    pub peak_pixel_bytes: usize,
}

/// Exact full-resolution results at the selected, penultimate, and final boundaries.
/// Other intermediate animations are released as processing advances.
#[derive(Clone, Default)]
pub struct RenderCache {
    source: Option<Arc<Animation>>,
    cards: Vec<Card>,
    checkpoints: Vec<(usize, Arc<Animation>)>,
    pub stats: RenderStats,
}
impl RenderCache {
    pub fn get(&self, index: usize) -> Option<&Arc<Animation>> {
        self.checkpoints
            .iter()
            .find(|(end, _)| *end == index + 1)
            .map(|(_, a)| a)
    }
    pub fn last(&self) -> Option<&Arc<Animation>> {
        self.cards.len().checked_sub(1).and_then(|i| self.get(i))
    }
    pub fn matches(&self, source: &Arc<Animation>, cards: &[Card]) -> bool {
        self.source
            .as_ref()
            .is_some_and(|old| Arc::ptr_eq(old, source))
            && self.cards == cards
    }
    pub fn retained_bytes(&self) -> usize {
        pixel_bytes(
            self.source
                .iter()
                .chain(self.checkpoints.iter().map(|(_, a)| a)),
        )
    }
    pub fn render(
        self,
        source: Arc<Animation>,
        cards: &[Card],
        preview: Option<usize>,
        displayed: Option<Arc<Animation>>,
    ) -> Result<Self> {
        self.render_with_budget(source, cards, preview, displayed, MAX_STACK_BYTES)
    }
    fn render_with_budget(
        mut self,
        source: Arc<Animation>,
        cards: &[Card],
        preview: Option<usize>,
        displayed: Option<Arc<Animation>>,
        budget: usize,
    ) -> Result<Self> {
        source.validate()?;
        ensure!(
            cards.len() <= MAX_OPERATIONS,
            "A stack can contain at most {MAX_OPERATIONS} operations"
        );
        ensure!(
            preview.is_none_or(|i| i < cards.len()),
            "Preview step does not exist"
        );
        let common = if self
            .source
            .as_ref()
            .is_some_and(|old| Arc::ptr_eq(old, &source))
        {
            self.cards
                .iter()
                .zip(cards)
                .take_while(|(a, b)| {
                    a == b
                        && !(b.enabled && matches!(b.operation, crate::Operation::Overlay { .. }))
                })
                .count()
        } else {
            0
        };
        self.checkpoints.retain(|(end, _)| *end <= common);
        self.source = None;
        self.cards.clear();
        let selected = preview.map_or(cards.len(), |i| i + 1);
        let preview_base = selected.checked_sub(1).filter(|i| {
            cards
                .get(*i)
                .is_some_and(|c| c.enabled && c.operation.has_preview_handles())
        });
        let mut targets = vec![selected, cards.len().saturating_sub(1), cards.len()];
        if let Some(base) = preview_base {
            targets.push(base);
        }
        targets.sort_unstable();
        targets.dedup();
        let mut retained = Vec::new();
        let mut current = source.clone();
        let mut end = 0;
        let mut stats = RenderStats::default();
        for target in targets {
            if let Some((cached_end, cached)) = self
                .checkpoints
                .iter()
                .filter(|(i, _)| *i > end && *i <= target)
                .max_by_key(|(i, _)| i)
            {
                stats.reused_steps += cached_end - end;
                end = *cached_end;
                current = cached.clone();
            }
            while end < target {
                let card = &cards[end];
                if !card.enabled {
                    end += 1;
                    continue;
                }
                let plan = card
                    .operation
                    .plan(&current)
                    .with_context(|| format!("{} (step {})", card.operation.name(), end + 1))?;
                let mut next_end = end + 1;
                let lookup = Lookup::new(&card.operation)
                    .map(|mut lookup| {
                        while next_end < target {
                            let next = &cards[next_end];
                            if !next.enabled {
                                next_end += 1;
                                continue;
                            }
                            let Some(next_lookup) = Lookup::new(&next.operation) else {
                                break;
                            };
                            next.operation.plan(&current).with_context(|| {
                                format!("{} (step {})", next.operation.name(), next_end + 1)
                            })?;
                            lookup.then(&next_lookup);
                            next_end += 1;
                        }
                        Ok::<_, anyhow::Error>(lookup)
                    })
                    .transpose()?;
                let mut live = pixel_bytes(
                    std::iter::once(&source)
                        .chain(displayed.iter())
                        .chain(std::iter::once(&current))
                        .chain(self.checkpoints.iter().map(|(_, a)| a))
                        .chain(retained.iter().map(|(_, a)| a)),
                );
                if live + plan.allocation > budget {
                    // Old checkpoints and the penultimate result are accelerators, not required outputs.
                    self.checkpoints.clear();
                    retained.retain(|(i, _)| {
                        *i == selected || *i == cards.len() || Some(*i) == preview_base
                    });
                    live = pixel_bytes(
                        std::iter::once(&source)
                            .chain(displayed.iter())
                            .chain(std::iter::once(&current))
                            .chain(retained.iter().map(|(_, a)| a)),
                    );
                }
                ensure!(
                    live + plan.allocation <= budget,
                    "{} would exceed the {} MiB render budget; resize earlier or preview a smaller input",
                    card.operation.name(),
                    budget / (1024 * 1024)
                );
                stats.peak_pixel_bytes = stats.peak_pixel_bytes.max(live + plan.allocation);
                current = Arc::new(if let Some(lookup) = lookup {
                    let count = cards[end..next_end].iter().filter(|c| c.enabled).count();
                    if count > 1 {
                        stats.fused_operations += count;
                    }
                    lookup.apply(&current)
                } else {
                    card.operation
                        .apply(&current, &plan)
                        .with_context(|| format!("{} (step {})", card.operation.name(), end + 1))?
                });
                current.validate()?;
                stats.passes += 1;
                end = next_end;
            }
            if target > 0 {
                retained.push((target, current.clone()));
            }
        }
        stats.peak_pixel_bytes = stats.peak_pixel_bytes.max(pixel_bytes(
            std::iter::once(&source)
                .chain(displayed.iter())
                .chain(retained.iter().map(|(_, a)| a)),
        ));
        ensure!(
            stats.peak_pixel_bytes <= budget,
            "Cached pixels exceed the render budget"
        );
        Ok(Self {
            source: Some(source),
            cards: cards.to_vec(),
            checkpoints: retained,
            stats,
        })
    }
}
fn pixel_bytes<'a>(animations: impl Iterator<Item = &'a Arc<Animation>>) -> usize {
    let mut seen = HashSet::new();
    animations
        .flat_map(|a| &a.frames)
        .filter(|f| seen.insert(Arc::as_ptr(&f.pixels)))
        .map(|f| f.pixels.as_raw().len())
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Frame, Operation};
    fn source() -> Arc<Animation> {
        Arc::new(Animation {
            frames: vec![Frame {
                pixels: image::RgbaImage::new(8, 8).into(),
                delay_ms: 10,
            }],
            repeat: gif::Repeat::Infinite,
        })
    }
    #[test]
    fn long_stacks_fit_a_constant_buffer_budget_and_old_display_is_counted() {
        let source = source();
        let cards: Vec<_> = (0..64)
            .map(|id| Card {
                id,
                enabled: true,
                operation: Operation::Negate,
            })
            .collect();
        let cache = RenderCache::default()
            .render_with_budget(source.clone(), &cards, None, None, 4 * 256)
            .unwrap();
        assert_eq!(cache.stats.passes, 2);
        assert_eq!(cache.retained_bytes(), 3 * 256);
        let old_display = Arc::new(source.as_ref().clone());
        // Force a distinct retained buffer, rather than another alias of the input.
        let mut old_display = old_display.as_ref().clone();
        old_display.frames[0].pixels = image::RgbaImage::new(8, 8).into();
        assert!(
            RenderCache::default()
                .render_with_budget(
                    source.clone(),
                    &cards[..1],
                    None,
                    Some(Arc::new(old_display)),
                    2 * 256
                )
                .is_err()
        );
        assert!(
            RenderCache::default()
                .render_with_budget(source, &cards[..1], None, None, 2 * 256)
                .is_ok()
        );
    }
}
