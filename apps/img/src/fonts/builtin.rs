use super::FontChoice;
use ab_glyph::FontArc;
use std::sync::OnceLock;

struct Builtin {
    id: &'static str,
    family: &'static str,
    bytes: &'static [u8],
    font: OnceLock<FontArc>,
}
static FONTS: [Builtin; 4] = [
    Builtin {
        id: "Anton-Regular",
        family: "Anton",
        bytes: include_bytes!("../../assets/fonts/anton/Anton-Regular.ttf"),
        font: OnceLock::new(),
    },
    Builtin {
        id: "BebasNeue-Regular",
        family: "Bebas Neue",
        bytes: include_bytes!("../../assets/fonts/bebasneue/BebasNeue-Regular.ttf"),
        font: OnceLock::new(),
    },
    Builtin {
        id: "Bangers-Regular",
        family: "Bangers",
        bytes: include_bytes!("../../assets/fonts/bangers/Bangers-Regular.ttf"),
        font: OnceLock::new(),
    },
    Builtin {
        id: "",
        family: "Inter",
        bytes: include_bytes!("../../assets/fonts/Inter-Regular.ttf"),
        font: OnceLock::new(),
    },
];
pub(super) fn choices() -> &'static [FontChoice] {
    static CHOICES: OnceLock<Vec<FontChoice>> = OnceLock::new();
    CHOICES.get_or_init(|| {
        FONTS
            .iter()
            .map(|font| FontChoice {
                id: font.id.into(),
                family: font.family.into(),
                style: "Regular".into(),
            })
            .collect()
    })
}
pub(super) fn resolve(id: &str) -> Option<FontArc> {
    let font = FONTS.iter().find(|font| font.id == id)?;
    Some(
        font.font
            .get_or_init(|| FontArc::try_from_slice(font.bytes).expect("Built-in caption font"))
            .clone(),
    )
}
