use super::*;
use rune::{App, Env, Runtime};
use std::time::Instant;

fn fixture() -> State {
    let mut s = State::empty();
    s.source = Some(Arc::new(crate::sample()));
    s.name = "sample.gif".into();
    s.playing = false;
    s.refresh();
    s
}
pub(super) fn runtime(size: (f32, f32), dark: bool) -> Runtime<State> {
    let mut rt = App::new(AppSpec {
        fonts: font_preview::FONTS,
        poll: Some(poll),
        on_key: Some(on_key),
        ..AppSpec::new("img", size, fixture, view::view)
    })
    .headless_runtime(size, Env::new(dark, 1.));
    rt.frame(0.);
    rt
}
pub(super) fn settle(rt: &mut Runtime<State>) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while rt.state.worker.busy() {
        assert!(Instant::now() < deadline, "Processing timed out");
        std::thread::sleep(Duration::from_millis(1));
        rt.frame(1. / 60.);
    }
    rt.frame(0.5);
    assert!(
        !rt.state.status.starts_with("Error:"),
        "{}",
        rt.state.status
    );
}
pub(super) fn click(rt: &mut Runtime<State>, key: &str) {
    let (x, y) = rt
        .find(key)
        .unwrap_or_else(|| panic!("Missing element {key}"));
    rt.pointer_down(x, y);
    rt.pointer_up(x, y);
    rt.frame(0.05);
    settle(rt);
}
pub(super) fn enter(rt: &mut Runtime<State>, key: &str, value: &str) {
    double_click(rt, key);
    rt.key(KeyEvent {
        key: Key::Command('a'),
        mods: Default::default(),
    });
    rt.key(KeyEvent {
        key: Key::Text(value.into()),
        mods: Default::default(),
    });
    rt.frame(0.01);
    rt.key(KeyEvent {
        key: Key::Enter,
        mods: Default::default(),
    });
    rt.frame(0.01);
    settle(rt);
}
pub(super) fn double_click(rt: &mut Runtime<State>, key: &str) {
    let (x, y) = rt
        .find(key)
        .unwrap_or_else(|| panic!("Missing element {key}"));
    for _ in 0..2 {
        rt.pointer_down(x, y);
        rt.pointer_up(x, y);
        rt.frame(0.01);
    }
    settle(rt);
}
pub(super) fn add(rt: &mut Runtime<State>, title: &str) {
    click(rt, "add");
    rt.key(KeyEvent {
        key: Key::Text(title.into()),
        mods: Default::default(),
    });
    rt.frame(0.05);
    let item = rt
        .elements()
        .into_iter()
        .find(|e| e.role == "option" && e.label.as_deref() == Some(title))
        .unwrap_or_else(|| panic!("Menu item {title} missing"));
    let [x, y, w, h] = item.rect;
    rt.pointer_down(x + w / 2., y + h / 2.);
    rt.pointer_up(x + w / 2., y + h / 2.);
    rt.frame(0.05);
    settle(rt);
}
pub(super) fn rect(rt: &Runtime<State>, key: &str) -> [f32; 4] {
    rt.elements()
        .into_iter()
        .find(|e| e.key.as_deref() == Some(key) && !e.exiting)
        .unwrap_or_else(|| panic!("Missing rect {key}"))
        .rect
}

mod colors;
mod fonts;
mod rendering;
mod stack;
mod text;
