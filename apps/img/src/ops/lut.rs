use super::{Animation, Frame, Operation, color, map_frames};
use image::{Rgba, RgbaImage};

pub(crate) struct Lookup {
    channels: [[u8; 256]; 4],
}

impl Lookup {
    pub(crate) fn new(operation: &Operation) -> Option<Self> {
        operation.validate_parameters().ok()?;
        use Operation::*;
        if !matches!(
            operation,
            Negate
                | Brightness { .. }
                | Contrast { .. }
                | Gamma { .. }
                | Exposure { .. }
                | ColorBalance { .. }
                | ColorTint { .. }
                | Posterize { .. }
                | Solarize { .. }
                | Opacity { .. }
                | AlphaThreshold { .. }
        ) {
            return None;
        }

        // Sample the existing implementation to keep its rounding and clipping exact.
        // Each supported operation transforms channels independently.
        let ramp = Animation {
            frames: vec![Frame {
                pixels: RgbaImage::from_fn(256, 1, |x, _| Rgba([x as u8; 4])).into(),
                delay_ms: 10,
            }],
            repeat: gif::Repeat::Infinite,
        };
        let mapped = color::apply(operation, &ramp);
        let channels = std::array::from_fn(|channel| {
            std::array::from_fn(|value| mapped.frames[0].pixels.get_pixel(value as u32, 0)[channel])
        });
        Some(Self { channels })
    }

    pub(crate) fn then(&mut self, next: &Self) {
        for (channel, next_channel) in self.channels.iter_mut().zip(&next.channels) {
            for value in channel {
                *value = next_channel[*value as usize];
            }
        }
    }

    pub(crate) fn apply(&self, source: &Animation) -> Animation {
        map_frames(source, true, |pixels, _| {
            let mut output = pixels.clone();
            for pixel in output.as_mut().as_chunks_mut::<4>().0 {
                for (value, channel) in pixel.iter_mut().zip(&self.channels) {
                    *value = channel[*value as usize];
                }
            }
            output
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn source() -> Animation {
        let pixels = Arc::new(RgbaImage::from_fn(256, 1, |x, _| {
            let value = x as u8;
            Rgba([
                value,
                255 - value,
                value.wrapping_mul(73),
                value.wrapping_mul(29),
            ])
        }));
        Animation {
            frames: vec![
                Frame {
                    pixels: pixels.clone(),
                    delay_ms: 30,
                },
                Frame {
                    pixels,
                    delay_ms: 170,
                },
            ],
            repeat: gif::Repeat::Finite(3),
        }
    }

    fn assert_matches(actual: &Animation, expected: &Animation) {
        assert_eq!(actual.repeat, expected.repeat);
        assert_eq!(actual.frames.len(), expected.frames.len());
        for (actual, expected) in actual.frames.iter().zip(&expected.frames) {
            assert_eq!(actual.delay_ms, expected.delay_ms);
            assert_eq!(actual.pixels, expected.pixels);
        }
        assert!(Arc::ptr_eq(
            &actual.frames[0].pixels,
            &actual.frames[1].pixels
        ));
    }

    #[test]
    fn individual_lookups_match_all_channel_values_and_preserve_shared_frames() {
        use Operation::*;
        let mut operations = vec![Negate];
        operations.extend([-255, -31, 0, 19, 255].map(|amount| Brightness { amount }));
        operations.extend([-100., -23.7, 0., 31.3, 100.].map(|amount| Contrast { amount }));
        operations.extend([0.1, 0.73, 1., 1.2, 5.].map(|gamma| Gamma { gamma }));
        operations.extend([-5., -0.7, 0., 1.3, 5.].map(|stops| Exposure { stops }));
        operations.push(ColorBalance {
            red: -255,
            green: 37,
            blue: 255,
        });
        operations.extend([0., 13.7, 50., 100.].map(|percent| ColorTint {
            red: 255,
            green: 73,
            blue: 0,
            percent,
        }));
        operations.extend([2, 3, 7, 64, 256].map(|levels| Posterize { levels }));
        operations.extend([0, 127, 255].map(|threshold| Solarize { threshold }));
        operations.extend([0., 13.7, 50., 100.].map(|percent| Opacity { percent }));
        operations.extend([0, 127, 255].map(|level| AlphaThreshold { level }));

        let source = source();
        let original = source.frames[0].pixels.clone();
        for operation in operations {
            let actual = Lookup::new(&operation).unwrap().apply(&source);
            let expected = color::apply(&operation, &source);
            assert_matches(&actual, &expected);
        }
        assert_eq!(source.frames[0].pixels, original);
    }

    #[test]
    fn composition_preserves_intermediate_clipping_rounding_and_operation_order() {
        use Operation::*;
        let operations = [
            Brightness { amount: 81 },
            Brightness { amount: -81 },
            Gamma { gamma: 1.37 },
            Contrast { amount: 47.3 },
            Exposure { stops: -0.73 },
            ColorBalance {
                red: 29,
                green: -47,
                blue: 63,
            },
            ColorTint {
                red: 31,
                green: 203,
                blue: 117,
                percent: 23.7,
            },
            Posterize { levels: 7 },
            Solarize { threshold: 131 },
            Negate,
            Opacity { percent: 73.3 },
            AlphaThreshold { level: 129 },
            Opacity { percent: 31.7 },
        ];
        let source = source();
        for ordered in [operations.to_vec(), operations.into_iter().rev().collect()] {
            let mut expected = color::apply(&ordered[0], &source);
            let mut lookup = Lookup::new(&ordered[0]).unwrap();
            for operation in &ordered[1..] {
                expected = color::apply(operation, &expected);
                lookup.then(&Lookup::new(operation).unwrap());
                assert_matches(&lookup.apply(&source), &expected);
            }
        }
    }

    #[test]
    fn dependent_operations_are_fusion_boundaries() {
        use Operation::*;
        for operation in [
            Grayscale,
            Sepia,
            Saturation { percent: 50. },
            Hue { degrees: 30. },
            Threshold { level: 128 },
            AutoLevels,
            Quantize { colors: 8 },
            Matte {
                red: 0,
                green: 0,
                blue: 0,
            },
            AlphaMask,
            RoundCorners { radius: 10 },
            Blur { sigma: 2. },
            Reverse,
        ] {
            assert!(Lookup::new(&operation).is_none());
        }
    }

    #[test]
    fn invalid_parameters_cannot_panic_during_fusion_probing() {
        for operation in [
            Operation::Posterize { levels: 0 },
            Operation::Brightness { amount: i32::MAX },
            Operation::Gamma { gamma: f32::NAN },
        ] {
            assert!(Lookup::new(&operation).is_none());
        }
    }
}
