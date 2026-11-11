mod ui;
fn main() -> anyhow::Result<()> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.first().is_some_and(|arg| arg == "--generate-sample") {
        anyhow::ensure!(args.len() == 2, "Usage: img --generate-sample OUTPUT.gif");
        sample().save(std::path::Path::new(&args[1]))?;
        println!("Generated {}", std::path::Path::new(&args[1]).display());
        return Ok(());
    }
    if args.first().is_some_and(|arg| arg == "--smoke") {
        anyhow::ensure!(
            args.len() == 3,
            "Usage: img --smoke INPUT.gif OUTPUT.gif\nimg --scene loaded|edited --snap OUTPUT.png [--size 980x820]"
        );
        let source = std::sync::Arc::new(img::Animation::load(std::path::Path::new(&args[1]))?);
        let cards = [
            img::Card {
                id: 1,
                enabled: true,
                operation: img::Operation::Resize {
                    width: 160,
                    height: 120,
                },
            },
            img::Card {
                id: 2,
                enabled: true,
                operation: img::Operation::Reverse,
            },
        ];
        let outputs = img::process(source, &cards)?;
        let output = outputs.last().unwrap();
        output.save(std::path::Path::new(&args[2]))?;
        let readback = img::Animation::load(std::path::Path::new(&args[2]))?;
        anyhow::ensure!(
            readback.frames.len() == output.frames.len() && readback.repeat == output.repeat,
            "Roundtrip metadata mismatch"
        );
        for (a, b) in output.frames.iter().zip(&readback.frames) {
            anyhow::ensure!(
                a.delay_ms == b.delay_ms && a.pixels.dimensions() == b.pixels.dimensions(),
                "Roundtrip frame mismatch"
            );
        }
        println!(
            "Verified {} frames, 160 × 120, reversed timings, loop {:?}",
            readback.frames.len(),
            readback.repeat
        );
        return Ok(());
    }
    if args.first().is_some_and(|arg| arg == "--help") {
        println!(
            "img [INPUT.gif]\nimg --generate-sample OUTPUT.gif\nimg --smoke INPUT.gif OUTPUT.gif\nimg --scene loaded|edited --snap OUTPUT.png [--size 980x820]"
        );
        return Ok(());
    }
    ui::run()
}

fn sample() -> img::Animation {
    let frames = (0..12)
        .map(|i| {
            let mut pixels = image::RgbaImage::new(240, 180);
            for y in 20..160 {
                for x in 20..220 {
                    pixels.put_pixel(x, y, image::Rgba([235, 240, 250, 255]));
                }
            }
            for y in 60..110 {
                for x in (24 + i * 13)..(64 + i * 13) {
                    pixels.put_pixel(x, y, image::Rgba([0, 66, 190, 255]));
                }
            }
            img::Frame {
                pixels: pixels.into(),
                delay_ms: if i == 11 { 350 } else { 80 },
            }
        })
        .collect();
    img::Animation {
        frames,
        repeat: gif::Repeat::Infinite,
    }
}
