//! Caption fonts shared by the editor and GIF renderer.
mod builtin;
use ab_glyph::{Font, FontArc, FontVec};
use anyhow::{Context, Result, bail};
use std::sync::{Mutex, OnceLock};

#[derive(Clone)]
pub struct FontChoice {
    pub id: String,
    pub family: String,
    pub style: String,
}
struct Catalog {
    database: fontdb::Database,
    choices: Vec<FontChoice>,
}
static CATALOG: OnceLock<Catalog> = OnceLock::new();
static CACHE: Mutex<Vec<(String, FontArc)>> = Mutex::new(Vec::new());

/// Call on a worker: enumerating installed fonts can involve filesystem I/O.
pub fn load_system_fonts() {
    CATALOG.get_or_init(|| {
        let mut database = fontdb::Database::new();
        database.load_system_fonts();
        let mut choices = builtin::choices().to_vec();
        for face in database.faces() {
            let Some((family, _)) = face.families.first() else {
                continue;
            };
            if family.starts_with('.') || face.post_script_name.is_empty() {
                continue;
            }
            let supported = database
                .with_face_data(face.id, |data, index| {
                    ab_glyph::FontRef::try_from_slice_and_index(data, index)
                        .is_ok_and(|font| font.outline(font.glyph_id('A')).is_some())
                })
                .unwrap_or(false);
            if !supported {
                continue;
            }
            let weight = match face.weight.0 {
                0..=150 => "Thin",
                151..=250 => "Extra light",
                251..=350 => "Light",
                351..=450 => "Regular",
                451..=550 => "Medium",
                551..=650 => "Semibold",
                651..=750 => "Bold",
                751..=850 => "Extra bold",
                _ => "Black",
            };
            let width = match face.stretch {
                fontdb::Stretch::UltraCondensed => "Ultra condensed ",
                fontdb::Stretch::ExtraCondensed => "Extra condensed ",
                fontdb::Stretch::Condensed => "Condensed ",
                fontdb::Stretch::SemiCondensed => "Semi condensed ",
                fontdb::Stretch::SemiExpanded => "Semi expanded ",
                fontdb::Stretch::Expanded => "Expanded ",
                fontdb::Stretch::ExtraExpanded => "Extra expanded ",
                fontdb::Stretch::UltraExpanded => "Ultra expanded ",
                _ if face.post_script_name.to_lowercase().contains("condensed") => "Condensed ",
                _ => "",
            };
            let suffix = match face.style {
                fontdb::Style::Normal => "",
                fontdb::Style::Italic => " Italic",
                fontdb::Style::Oblique => " Oblique",
            };
            choices.push(FontChoice {
                id: face.post_script_name.clone(),
                family: family.clone(),
                style: format!("{width}{weight}{suffix}"),
            });
        }
        choices[builtin::choices().len()..]
            .sort_by_cached_key(|f| (f.family.to_lowercase(), f.style.clone(), f.id.clone()));
        let mut seen = std::collections::HashSet::new();
        choices.retain(|f| seen.insert(f.id.clone()));
        Catalog { database, choices }
    });
}
/// Available after the background scan; the UI never waits for enumeration.
pub fn choices() -> Option<&'static [FontChoice]> {
    CATALOG.get().map(|catalog| catalog.choices.as_slice())
}
/// Fonts available immediately, before the installed-font scan completes.
pub fn builtins() -> &'static [FontChoice] {
    builtin::choices()
}

const COMMON: &[&str] = &[
    "Impact",
    "Anton",
    "Bebas Neue",
    "Bangers",
    "Inter",
    "Arial",
    "Arial Black",
    "Helvetica",
    "Comic Sans MS",
    "Georgia",
    "Times New Roman",
    "Courier New",
];

pub fn common_family(family: &str) -> bool {
    COMMON.iter().any(|name| family.eq_ignore_ascii_case(name))
}

/// One entry per family, with common caption choices first. Face IDs remain stable.
pub fn families(choices: &[FontChoice]) -> Vec<&FontChoice> {
    let mut seen = std::collections::HashSet::new();
    let mut families: Vec<_> = choices
        .iter()
        .filter(|font| seen.insert(font.family.to_lowercase()))
        .map(|font| preferred_face(choices, &font.family, "Regular").expect("Family has a face"))
        .collect();
    families.sort_by_cached_key(|font| {
        (
            COMMON
                .iter()
                .position(|name| font.family.eq_ignore_ascii_case(name))
                .unwrap_or(COMMON.len()),
            font.family.to_lowercase(),
        )
    });
    families
}
/// Preserve an available style when changing family, otherwise select its regular face.
pub fn preferred_face<'a>(
    choices: &'a [FontChoice],
    family: &str,
    style: &str,
) -> Option<&'a FontChoice> {
    let faces = || {
        choices
            .iter()
            .filter(|font| font.family.eq_ignore_ascii_case(family))
    };
    faces()
        .find(|font| font.style == style)
        .or_else(|| faces().find(|font| font.style == "Regular"))
        .or_else(|| faces().next())
}

pub fn resolve(id: &str) -> Result<FontArc> {
    if let Some(font) = builtin::resolve(id) {
        return Ok(font);
    }
    let mut cache = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(index) = cache.iter().position(|(key, _)| key == id) {
        let entry = cache.remove(index);
        let font = entry.1.clone();
        cache.push(entry);
        return Ok(font);
    }
    load_system_fonts();
    let catalog = CATALOG.get().expect("Font catalog initialized");
    let Some(face) = catalog
        .database
        .faces()
        .find(|face| face.post_script_name == id)
    else {
        bail!("Font ‘{id}’ is no longer installed. Choose another font.");
    };
    let font: FontArc = catalog
        .database
        .with_face_data(face.id, |bytes, index| {
            FontVec::try_from_vec_and_index(bytes.to_vec(), index)
        })
        .context("Cannot read the selected font file")??
        .into();
    if font.outline(font.glyph_id('A')).is_none() {
        bail!("This font has no supported text outlines. Choose another font.");
    }
    if cache.len() == 8 {
        cache.remove(0);
    }
    cache.push((id.into(), font.clone()));
    Ok(font)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn common_families_are_unique_ordered_and_keep_available_styles() {
        let make = |id: &str, family: &str, style: &str| FontChoice {
            id: id.into(),
            family: family.into(),
            style: style.into(),
        };
        let mut choices = builtins().to_vec();
        choices.extend([
            make("z", "Zebra", "Regular"),
            make("impact", "Impact", "Regular"),
            make("sans-bold", "Arial", "Bold"),
            make("sans", "Arial", "Regular"),
        ]);
        let names: Vec<_> = families(&choices)
            .iter()
            .map(|font| font.family.as_str())
            .collect();
        assert_eq!(
            names,
            [
                "Impact",
                "Anton",
                "Bebas Neue",
                "Bangers",
                "Inter",
                "Arial",
                "Zebra"
            ]
        );
        assert_eq!(
            preferred_face(&choices, "Arial", "Bold").unwrap().id,
            "sans-bold"
        );
        assert_eq!(
            preferred_face(&choices, "Arial", "Missing style")
                .unwrap()
                .id,
            "sans"
        );
        assert!(
            builtins()
                .iter()
                .all(|font| !font.style.contains("bundled"))
        );
    }
}
