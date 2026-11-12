use image::{Rgba, RgbaImage};
use std::collections::{HashMap, HashSet};

enum Lookup {
    Exact(HashMap<[u8; 3], u8>),
    Quantized(color_quant::NeuQuant),
}
pub(crate) struct Palette {
    colors: Vec<[u8; 3]>,
    lookup: Lookup,
    transparent: Option<u8>,
}
impl Palette {
    pub(crate) fn new<'a>(
        limit: usize,
        pixels: impl Iterator<Item = &'a Rgba<u8>> + Clone,
    ) -> Self {
        let mut transparent = false;
        let mut unique = HashSet::new();
        let mut visible = 0usize;
        for p in pixels.clone() {
            if p[3] == 0 {
                transparent = true;
            } else {
                visible += 1;
                if unique.len() <= limit {
                    unique.insert([p[0], p[1], p[2]]);
                }
            }
        }
        let capacity = limit - usize::from(transparent);
        let (mut colors, lookup) = if unique.len() <= capacity {
            let mut colors: Vec<_> = unique.into_iter().collect();
            colors.sort_unstable();
            let lookup = colors
                .iter()
                .copied()
                .enumerate()
                .map(|(i, c)| (c, i as u8))
                .collect();
            (colors, Lookup::Exact(lookup))
        } else {
            let stride = visible.div_ceil(65536).max(1);
            let samples: Vec<_> = pixels
                .filter(|p| p[3] > 0)
                .step_by(stride)
                .flat_map(|p| [p[0], p[1], p[2], 255])
                .collect();
            let speed = if samples.len() / 4 < capacity * 10 {
                1
            } else {
                10
            };
            let quantizer = color_quant::NeuQuant::new(speed, capacity, &samples);
            let colors = quantizer.color_map_rgb().as_chunks::<3>().0.to_vec();
            (colors, Lookup::Quantized(quantizer))
        };
        let transparent = if transparent {
            let index = colors.len() as u8;
            colors.push([0, 0, 0]);
            Some(index)
        } else {
            None
        };
        Self {
            colors,
            lookup,
            transparent,
        }
    }
    fn index(&self, p: &Rgba<u8>) -> u8 {
        if p[3] == 0 {
            return self
                .transparent
                .expect("Palette includes transparent pixels");
        }
        match &self.lookup {
            Lookup::Exact(colors) => *colors
                .get(&[p[0], p[1], p[2]])
                .expect("Palette includes source colors"),
            Lookup::Quantized(q) => q.index_of(&[p[0], p[1], p[2], 255]) as u8,
        }
    }
    pub(crate) fn map(&self, p: &Rgba<u8>) -> Rgba<u8> {
        let c = self.colors[self.index(p) as usize];
        Rgba([c[0], c[1], c[2], p[3]])
    }
}
pub(crate) fn encode_frame(pixels: &RgbaImage, delay_ms: u32) -> gif::Frame<'static> {
    let palette = Palette::new(256, pixels.pixels());
    let indexed: Vec<_> = pixels.pixels().map(|p| palette.index(p)).collect();
    let rgb: Vec<_> = palette.colors.iter().flatten().copied().collect();
    let mut frame = gif::Frame::from_palette_pixels(
        pixels.width() as u16,
        pixels.height() as u16,
        indexed,
        rgb,
        palette.transparent,
    );
    frame.delay = ((delay_ms + 5) / 10) as u16;
    frame.dispose = gif::DisposalMethod::Background;
    frame
}
