use super::*;
use rune::{Drag, Live, Phase};

pub(super) struct ListLayout {
    pub viewport: [f32; 4],
    pub position: Live<[f32; 2]>,
}
impl Default for ListLayout {
    fn default() -> Self {
        Self {
            viewport: [0.; 4],
            position: Live::new([0., 0.]),
        }
    }
}
impl ListLayout {
    fn scroll(&self) -> f32 {
        self.position.get()[0]
    }
}
pub(super) struct DragState {
    pub id: u64,
    pub from: usize,
    pub to: usize,
    pub dy: f32,
    heights: Vec<f32>,
    width: f32,
    origin_y: f32,
    pointer_x: f32,
    pub raw_dy: Live<f32>,
    pub offset: Live<[f32; 2]>,
    pub held_origin: [f32; 2],
    pub initial_scroll: f32,
    edge_target: Option<f32>,
}
impl DragState {
    fn follow(&mut self, scroll: f32) {
        self.dy = self.raw_dy.get() + scroll - self.initial_scroll;
        self.offset.set([self.offset.get()[0], self.raw_dy.get()]);
        let start: f32 = self.heights[..self.from].iter().map(|h| h + 8.).sum();
        let center = start + self.heights[self.from] / 2. + self.dy;
        let mut y = 0.;
        self.to = self.from;
        for (i, height) in self.heights.iter().enumerate() {
            if i < self.from && center < y + height / 2. {
                self.to = self.to.min(i);
            }
            if i > self.from && center > y + height / 2. {
                self.to = self.to.max(i);
            }
            y += height + 8.;
        }
    }
}
impl State {
    pub(super) fn drag(
        &mut self,
        id: u64,
        d: &Drag,
        heights: &[f32],
        width: f32,
        origin: [f32; 2],
        tx: &mut Tx,
    ) {
        if !self.editable() {
            return;
        }
        let scroll = self.list.scroll();
        match d.phase {
            Phase::Down => {
                let Some(from) = self.cards.iter().position(|c| c.id == id) else {
                    return;
                };
                self.close_color();
                self.dragging = Some(DragState {
                    id,
                    from,
                    to: from,
                    dy: 0.,
                    heights: heights.to_vec(),
                    width,
                    initial_scroll: scroll,
                    origin_y: origin[1] + 8. + d.start_y,
                    held_origin: origin,
                    pointer_x: d.start_x + 8.,
                    raw_dy: Live::new(0.),
                    offset: Live::new([0., 0.]),
                    edge_target: None,
                });
                tx.instant();
            }
            Phase::Move => {
                let Some(drag) = &mut self.dragging else {
                    return;
                };
                drag.raw_dy.set(d.dy);
                drag.offset.set([d.dx, d.dy]);
                drag.pointer_x = d.start_x + d.dx + 8.;
                let previous = drag.to;
                drag.follow(scroll);
                if previous != drag.to {
                    tx.animated();
                } else {
                    tx.live_only();
                }
            }
            Phase::Up => {
                if let Some(mut drag) = self.dragging.take() {
                    if drag.edge_target.is_some() {
                        tx.scroll_to_instant("operation-scroll", 0., scroll);
                    }
                    drag.raw_dy.set(d.dy);
                    drag.follow(scroll);
                    let x = d.start_x + d.dx + 8.;
                    let prefix: f32 = drag.heights[..drag.from].iter().map(|h| h + 8.).sum();
                    let y = prefix + 8. + d.start_y + drag.dy;
                    let bottom: f32 = drag.heights.iter().map(|h| h + 8.).sum();
                    let pointer_y = drag.origin_y + d.dy;
                    let [_, vy, _, vh] = self.list.viewport;
                    if !d.cancelled()
                        && (0. ..=drag.width).contains(&x)
                        && (-12. ..=bottom + 12.).contains(&y)
                        && (vy - 12. ..=vy + vh + 12.).contains(&pointer_y)
                        && drag.from != drag.to
                    {
                        self.move_card(drag.from, drag.to);
                    }
                    tx.animated();
                }
            }
        }
    }
    pub(super) fn drag_frame(&mut self, tx: &mut Tx) -> bool {
        let scroll = self.list.scroll();
        let Some(drag) = &mut self.dragging else {
            return false;
        };
        let previous = drag.to;
        drag.follow(scroll);
        let [_, y, _, h] = self.list.viewport;
        let pointer_y = drag.origin_y + drag.raw_dy.get();
        let edge = if (0. ..=drag.width).contains(&drag.pointer_x)
            && (y - 12. ..=y + h + 12.).contains(&pointer_y)
        {
            if pointer_y > y + h - 36. {
                Some(self.list.position.get()[1])
            } else if pointer_y < y + 36. {
                Some(0.)
            } else {
                None
            }
        } else {
            None
        };
        if edge != drag.edge_target {
            if let Some(target) = edge {
                tx.scroll_to_with("operation-scroll", 0., target, rune::Spring::new(0.8, 0.));
            } else if drag.edge_target.is_some() {
                tx.scroll_to_instant("operation-scroll", 0., scroll);
            }
            drag.edge_target = edge;
        }
        if edge.is_some_and(|target| (target - scroll).abs() > 0.1) {
            tx.wake_after(Duration::from_millis(16));
        }
        if previous != drag.to {
            tx.animated();
        }
        previous != drag.to
    }
}
