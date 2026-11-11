#[path = "color.rs"]
pub(super) mod color;
#[path = "edit_controls.rs"]
mod edit_controls;
#[path = "font_menu.rs"]
mod font_menu;
#[path = "font_picker.rs"]
mod font_picker;
#[path = "number.rs"]
pub(super) mod number;
#[path = "operations.rs"]
mod operations;
#[path = "placement.rs"]
pub(super) mod placement;
#[path = "spatial.rs"]
pub(super) mod spatial;
use super::icons::*;
use super::*;
use rune::{
    Color, Cx, El, FileDialogOptions, Icon, SurfaceFit, col, el, icon, row, text, text_input,
};
use rune_kit::Kit;

// Rune's `disabled` is accessibility metadata; inert also blocks input.
trait Blocked {
    fn blocked(self, disabled: bool) -> Self;
}
impl Blocked for El {
    fn blocked(self, disabled: bool) -> Self {
        if disabled {
            self.disabled(true).inert().opacity(0.4)
        } else {
            self
        }
    }
}
fn ink() -> Color {
    rune::oklch(0.26, 0., 0.)
}
fn muted() -> Color {
    rune::oklch(0.48, 0., 0.)
}
fn line() -> Color {
    rune::oklch(0.91, 0., 0.)
}
fn label(value: impl Into<String>) -> El {
    text(value)
        .font(rune::tok::type_::LABEL.lh(16.))
        .color(ink())
}
fn input_box(input: El, width: f32, multiline: bool) -> El {
    let input = input
        .font(rune::tok::type_::LABEL.lh(16.))
        .color(ink())
        .caret(ink(), rune::oklch(0.85, 0., 0.));
    let box_ = if multiline {
        col()
            .role("textbox")
            .w(width)
            .h(60.)
            .padding(6.)
            .scroll(rune::ScrollSpec {
                stick_bottom: false,
            })
            .child(input.w_full().min_h(48.))
    } else {
        input.single_line().w(width).h(26.).px(6.).py(5.)
    };
    box_.radius(2.)
        .border(0.75, line())
        .focus_within_ring(1., -1., muted())
}
fn button(
    key: impl Into<String>,
    title: impl Into<String>,
    action: impl Fn(&mut State, &mut Tx) + 'static,
) -> El {
    let title = title.into();
    row()
        .key(key.into())
        .role("button")
        .label(title.clone())
        .focusable(true)
        .h(24.)
        .px(8.)
        .center()
        .radius(2.)
        .fill(Color::WHITE)
        .border(0.75, line())
        .hover(rune::oklch(0.96, 0., 0.))
        .on_press_tx(action)
        .child(label(title).truncate())
}
fn icon_button(
    key: impl Into<String>,
    title: impl Into<String>,
    glyph: &'static Icon,
    action: impl Fn(&mut State, &mut Tx) + 'static,
) -> El {
    let title = title.into();
    el().key(key.into())
        .role("button")
        .label(title.clone())
        .help(title)
        .focusable(true)
        .size(22., 24.)
        .center()
        .radius(2.)
        .hover(rune::oklch(0.95, 0., 0.))
        .on_press_tx(action)
        .child(icon(glyph, 16.).color(ink()))
}
fn pill(title: &str) -> El {
    el().px(6.)
        .py(3.)
        .radius(3.)
        .fill(rune::oklch(0.98, 0., 0.))
        .child(label(title).truncate())
}
fn frame(selected: bool) -> El {
    col()
        .w_full()
        .padding(8.)
        .gap(6.)
        .fill(Color::WHITE)
        .radius(3.)
        .border(
            0.75,
            if selected {
                rune::oklch(0.84, 0., 0.)
            } else {
                line()
            },
        )
}
fn preview_button(id: u64, selected: bool, ready: bool) -> El {
    icon_button(
        format!("preview-{id}"),
        if selected {
            "Previewing this step"
        } else {
            "Preview this step"
        },
        &PREVIEW,
        move |s, tx| {
            s.select(id);
            tx.instant();
        },
    )
    .checked(selected)
    .fill(if selected {
        rune::oklch(0.94, 0., 0.)
    } else {
        Color::WHITE
    })
    .blocked(!ready)
}

pub(super) fn open(s: &mut State, tx: &mut Tx) {
    if s.worker.busy() {
        return;
    }
    tx.open_file(
        FileDialogOptions {
            title: "Open GIF".into(),
            ..Default::default()
        }
        .filter("GIF", &["gif"]),
        |s: &mut State, result, tx| match result {
            Ok(Some(path)) => {
                s.flush_fields(tx);
                s.request_io(worker::IoJob::Load(path));
            }
            Ok(None) => {}
            Err(e) => s.status = format!("Error: {e}"),
        },
    );
}
pub(super) fn export(s: &mut State, tx: &mut Tx) {
    let Some(output) = s.final_output() else {
        return;
    };
    tx.save_file(
        FileDialogOptions {
            title: "Export GIF".into(),
            file_name: Some("edited.gif".into()),
            ..Default::default()
        }
        .filter("GIF", &["gif"]),
        move |s: &mut State, result, _| match result {
            Ok(Some(path)) => {
                let output = output.clone();
                s.request_io(worker::IoJob::Save(output, path));
            }
            Ok(None) => {}
            Err(e) => s.status = format!("Error: {e}"),
        },
    );
}
fn source(s: &State, selected: u64) -> El {
    let collapsed = s.source.is_some() && s.collapsed.contains(&0);
    let mut card = frame(selected == 0 && s.source.is_some())
        .key("import")
        .h(if collapsed { 40. } else { 94. })
        .child(
            row()
                .gap(4.)
                .center_y()
                .child(
                    icon_button(
                        "collapse-0",
                        "Collapse or expand import",
                        &CHEVRON,
                        |s, tx| {
                            s.toggle_collapsed(0);
                            tx.animated();
                        },
                    )
                    .rotate(if collapsed {
                        0.
                    } else {
                        std::f32::consts::FRAC_PI_2
                    })
                    .blocked(s.source.is_none()),
                )
                .child(pill("Import GIF").help(&s.name))
                .child(
                    label(&s.name)
                        .key("source-name")
                        .min_w(0.)
                        .grow(1.)
                        .truncate()
                        .help(&s.name)
                        .color(muted()),
                )
                .child(preview_button(0, selected == 0, s.source.is_some())),
        );
    if collapsed {
        return card;
    }
    if let Some(animation) = &s.source {
        let pixels = &animation.frames[0].pixels;
        card = card.child(
            label(format!(
                "{} × {} pixels, {} frames",
                pixels.width(),
                pixels.height(),
                animation.frames.len()
            ))
            .color(muted()),
        );
    } else {
        card = card.child(label(" "));
    }
    card.child(
        row().child(
            button(
                "open",
                if s.source.is_some() {
                    "Replace GIF…"
                } else {
                    "Choose GIF…"
                },
                open,
            )
            .blocked(s.worker.busy()),
        ),
    )
}
fn preview(s: &State, cx: &mut Cx<State>) -> El {
    let mut panel = col()
        .key("preview")
        .grow(1.)
        .min_w(0.)
        .h_full()
        .padding(12.)
        .gap(8.);
    let Some(animation) = &s.displayed else {
        return panel.center().child(
            label(if s.worker.busy() {
                "Loading…"
            } else {
                "Open a GIF or paste an image."
            })
            .color(muted()),
        );
    };
    let (w, h) = animation.frames[0].pixels.dimensions();
    panel = panel.child(
        row()
            .gap(6.)
            .center_y()
            .child(
                label(if let Some(hint) = color::sample_hint(s) {
                    hint.into()
                } else {
                    format!("{w} × {h} pixels")
                })
                .color(muted()),
            )
            .child(el().grow(1.))
            .child(
                button("fit", "Fit", |s, tx| {
                    s.actual_size = false;
                    tx.instant();
                })
                .fill(if !s.actual_size {
                    rune::oklch(0.95, 0., 0.)
                } else {
                    Color::WHITE
                }),
            )
            .child(
                button("actual", "100%", |s, tx| {
                    s.actual_size = true;
                    tx.instant();
                })
                .fill(if s.actual_size {
                    rune::oklch(0.95, 0., 0.)
                } else {
                    Color::WHITE
                }),
            ),
    );
    let image = if s.actual_size {
        el().key("image").size(w as f32, h as f32).pixels(&s.pixels)
    } else {
        el().key("image")
            .w_full()
            .h_full()
            .pixels_fit(&s.pixels, SurfaceFit::Fit)
    };
    let mut canvas = col().key("canvas").grow(1.).min_h(80.).w_full();
    if s.actual_size {
        canvas = canvas.scroll_xy();
    }
    let image = image.on_layout_tx(|s: &mut State, rect, tx| {
        let size = [rect[2], rect[3]];
        if s.preview_size != size {
            s.preview_size = size;
            tx.instant();
            tx.wake_after(Duration::ZERO);
        } else {
            tx.live_only();
        }
    });
    let image_size = if s.preview_size[0] > 0. && s.preview_size[1] > 0. {
        s.preview_size
    } else {
        cx.layout_size("image").unwrap_or([560., 400.])
    };
    let image = placement::image(s, image, image_size);
    let image = spatial::image(s, image, image_size);
    panel = panel.child(canvas.child(color::sample_image(s, image)));
    panel = panel.child(
        row()
            .gap(6.)
            .center_y()
            .child(
                icon_button("previous", "Previous frame", &PREVIOUS, |s, _| {
                    s.seek(s.frame.saturating_sub(1))
                })
                .blocked(s.frame == 0),
            )
            .child(button(
                "play",
                if s.playing { "Pause" } else { "Play" },
                |s, _| {
                    if s.placement.is_none() && s.spatial.is_none() {
                        s.playing = !s.playing;
                    }
                },
            ))
            .child(
                icon_button("next", "Next frame", &NEXT, |s, _| {
                    if let Some(a) = &s.displayed {
                        s.seek((s.frame + 1).min(a.frames.len() - 1));
                    }
                })
                .blocked(s.frame + 1 == animation.frames.len()),
            )
            .child(label(format!(
                "Frame {} of {}",
                s.frame + 1,
                animation.frames.len()
            ))),
    );
    let total: u32 = animation.frames.iter().map(|f| f.delay_ms).sum();
    panel = panel.child(
        row()
            .gap(8.)
            .center_y()
            .child(button(
                "frames",
                if s.frames_open {
                    "Hide frames"
                } else {
                    "Show frames"
                },
                |s, tx| {
                    s.frames_open = !s.frames_open;
                    tx.instant();
                },
            ))
            .child(label(format!("{:.2}s total", total as f32 / 1000.)).color(muted())),
    );
    if s.frames_open {
        // Build only the visible thumbnails; the decoded 80×56 cache is bounded by MAX_FRAMES.
        let viewport_x = cx.layout("filmstrip").map_or(0., |r| r[0]);
        let offset = cx
            .layout("filmstrip-content")
            .map_or(0., |r| viewport_x - r[0]);
        let visible = cx.layout_size("filmstrip").map_or(500., |r| r[0]);
        let start = (offset.max(0.) / 88.).floor() as usize;
        let end = ((offset.max(0.) + visible) / 88.).ceil() as usize + 1;
        let mut strip = row().key("filmstrip-content").gap(8.).h(86.);
        if start > 0 {
            strip = strip.child(
                el().w(start.min(animation.frames.len()) as f32 * 88. - 8.)
                    .h(86.),
            );
        }
        for index in start..end.min(animation.frames.len()) {
            let thumb = col()
                .key(format!("frame-{index}"))
                .w(80.)
                .h(86.)
                .gap(3.)
                .padding(3.)
                .radius(2.)
                .border(0.75, if index == s.frame { ink() } else { line() })
                .role("button")
                .label(format!("Frame {}", index + 1))
                .focusable(true)
                .on_press(move |s: &mut State| s.seek(index))
                .child(
                    el().w_full()
                        .h(56.)
                        .pixels_fit(&s.thumbnail(index), SurfaceFit::Fit),
                )
                .child(
                    label(format!(
                        "{} · {}ms",
                        index + 1,
                        animation.frames[index].delay_ms
                    ))
                    .color(muted()),
                );
            strip = strip.child(thumb);
        }
        if end < animation.frames.len() {
            strip = strip.child(
                el().w((animation.frames.len() - end) as f32 * 88. - 8.)
                    .h(86.),
            );
        }
        panel = panel
            .child(
                row()
                    .key("filmstrip")
                    .w_full()
                    .h(90.)
                    .scroll_x()
                    .child(strip),
            )
            .child(
                label(format!(
                    "Frame {} · {} ms",
                    s.frame + 1,
                    animation.frames[s.frame].delay_ms
                ))
                .color(muted()),
            );
    }
    panel
}
pub(super) fn view(s: &State, cx: &mut Cx<State>) -> El {
    let kit = kit();
    let mut overlays = vec![];
    let selected = s
        .selected
        .unwrap_or_else(|| s.cards.last().map_or(0, |c| c.id));
    let mut steps = col()
        .key("steps")
        .w_full()
        .gap(8.)
        .child(source(s, selected));
    let heights: Vec<_> = s
        .cards
        .iter()
        .map(|c| {
            cx.layout_size(&format!("step-{}", c.id)).map_or(
                if c.operation.parameters().is_empty() || s.collapsed.contains(&c.id) {
                    40.
                } else {
                    52. + c.operation.parameters().len().div_ceil(2) as f32 * 50.
                },
                |r| r[1],
            )
        })
        .collect();
    let width = cx.layout_size("steps").map_or(340., |r| r[0]);
    for index in 0..s.cards.len() {
        let origin = if s.dragging.is_none() {
            cx.layout(&format!("step-{}", s.cards[index].id))
                .map_or([10., 0.], |r| [r[0], r[1]])
        } else {
            [0., 0.]
        };
        steps = steps.child(operations::card(
            s,
            index,
            &heights,
            width,
            origin,
            selected,
            &mut overlays,
        ));
    }
    let menu = operations::picker(s, &kit, &mut overlays);
    steps = steps
        .child(
            row()
                .gap(8.)
                .child(menu)
                .child(button("export", "Export result…", export).blocked(!s.ready()))
                .child(
                    icon_button(
                        "collapse-all",
                        "Collapse or expand all operations",
                        &COLLAPSE,
                        |s, tx| {
                            s.collapse_all();
                            tx.animated();
                        },
                    )
                    .blocked(s.cards.is_empty() || s.dragging.is_some()),
                ),
        )
        .child(
            el().key("status").h(44.).w_full().child(
                label(&s.status)
                    .w_full()
                    .truncate()
                    .help(&s.status)
                    .role(if s.status.starts_with("Error:") {
                        "alert"
                    } else {
                        "status"
                    })
                    .color(muted()),
            ),
        );
    let scroll_position = s.list.position.clone();
    let scroll = col()
        .key("operation-scroll")
        .cursor(if s.dragging.is_some() {
            rune::Cursor::Grabbing
        } else {
            rune::Cursor::Default
        })
        .on_scroll_offset(move |at| {
            scroll_position.set([at.offset[1], at.max[1]]);
        })
        .on_layout_tx(|s: &mut State, rect, tx| {
            let compact_changed = (s.list.viewport[3] > 0. && s.list.viewport[3] < 480.)
                != (rect[3] > 0. && rect[3] < 480.);
            s.list.viewport = rect;
            if s.color.draft.is_none() || !compact_changed {
                tx.live_only();
            }
        })
        .w_full()
        .grow(1.)
        .min_h(0.)
        .scroll(rune::ScrollSpec {
            stick_bottom: false,
        })
        .child(steps);
    let left = col()
        .w(s.pane_width
            .min(cx.layout_size("window").map_or(980., |r| r[0]) - 320.)
            .max(320.))
        .h_full()
        .padding(10.)
        .gap(8.)
        .child(edit_controls::toolbar(s, &mut overlays))
        .child(scroll);
    rune_kit::root(
        row()
            .key("window")
            .on_paste_content(|s: &mut State, content, _| s.paste_content(content))
            .w_full()
            .h_full()
            .fill(Color::WHITE)
            .child(left)
            .child(
                el().key("pane-divider")
                    .w(4.)
                    .h_full()
                    .center()
                    .cursor(rune::Cursor::ResizeColumn)
                    .on_drag(|s: &mut State, drag, tx| {
                        match drag.phase {
                            rune::Phase::Down => drag.data = s.pane_width,
                            rune::Phase::Move => {
                                s.pane_width = (drag.data + drag.dx).clamp(320., 460.)
                            }
                            rune::Phase::Up => {}
                        }
                        tx.instant();
                    })
                    .child(el().w(0.75).h_full().fill(line())),
            )
            .child(preview(s, cx)),
        overlays,
    )
}

fn kit() -> Kit {
    let mut kit = Kit::neutral(false);
    kit.c.border_focus = ink();
    kit.c.text_accent = ink();
    kit.c.icon_accent = ink();
    kit.c.bg_accent = ink();
    kit.radius.sm = 2.;
    kit.radius.md = 3.;
    kit.radius.lg = 3.;
    kit
}
