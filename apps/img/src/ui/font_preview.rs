use rune::{Family, TextStyle};
use std::{cell::RefCell, collections::HashMap};

pub(super) const FONTS: &[&[u8]] = &[
    include_bytes!("../../assets/fonts/Inter-Regular.ttf"),
    include_bytes!("../../assets/fonts/Inter-Medium.ttf"),
    include_bytes!("../../assets/fonts/Inter-SemiBold.ttf"),
    include_bytes!("../../assets/fonts/anton/Anton-Regular.ttf"),
    include_bytes!("../../assets/fonts/bebasneue/BebasNeue-Regular.ttf"),
    include_bytes!("../../assets/fonts/bangers/Bangers-Regular.ttf"),
];

thread_local! {
    static NAMES: RefCell<HashMap<String, &'static str>> = RefCell::new(HashMap::new());
}

pub(super) fn style(family: &str, size: f32) -> TextStyle {
    // Rune's family handle is static. Intern catalog names only, never user search text.
    let family = NAMES.with(|names| {
        let mut names = names.borrow_mut();
        *names.entry(family.into()).or_insert_with(|| {
            let quoted = format!(
                "\"{}\", sans-serif",
                family.replace('\\', "\\\\").replace('"', "\\\"")
            );
            Box::leak(
                if family.contains(',') {
                    quoted
                } else {
                    family.to_owned()
                }
                .into_boxed_str(),
            )
        })
    });
    TextStyle::new(size, 400.)
        .family(Family::Named(family))
        .lh(size + 6.)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn embedded_caption_families_resolve_to_distinct_native_faces() {
        let mut text = rune::text::TextSystem::new(FONTS, ("Inter", "Inter"));
        let mut widths = std::collections::HashSet::new();
        for font in img::fonts::builtins() {
            let style = style(&font.family, 16.);
            let size = text.measure("Sample caption", style, 2.);
            assert!(size.0 > 0. && size.1 > 0.);
            assert!(
                widths.insert((size.0 * 2.) as u32),
                "{} must resolve its embedded face",
                font.family
            );
        }
    }
}
