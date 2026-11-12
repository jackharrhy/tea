use super::*;

pub(super) type SampleResult = Result<Option<[u8; 3]>, String>;

#[cfg(target_os = "macos")]
pub(super) fn sample(waker: Option<Waker>) -> Result<mpsc::Receiver<SampleResult>, String> {
    use block2::RcBlock;
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSColor, NSColorSampler, NSColorSpace};
    MainThreadMarker::new().ok_or("Screen sampling must start on the main thread")?;
    let (sender, receiver) = mpsc::channel();
    let callback = RcBlock::new(move |color: *mut NSColor| {
        // AppKit supplies a borrowed NSColor for this callback, or nil on cancellation.
        let result = unsafe { color.as_ref() }
            .map(|color| {
                color
                    .colorUsingColorSpace(&NSColorSpace::sRGBColorSpace())
                    .map(|rgb| {
                        [
                            rgb.redComponent(),
                            rgb.greenComponent(),
                            rgb.blueComponent(),
                        ]
                        .map(|v| (v.clamp(0., 1.) * 255.).round() as u8)
                    })
                    .ok_or_else(|| "Could not convert the sampled color to sRGB".into())
            })
            .transpose();
        let _ = sender.send(result);
        if let Some(waker) = &waker {
            waker();
        }
    });
    let sampler = NSColorSampler::new();
    // AppKit retains the sampler and copies the handler until selection or cancellation.
    unsafe {
        sampler.showSamplerWithSelectionHandler(&callback);
    }
    Ok(receiver)
}

#[cfg(not(target_os = "macos"))]
pub(super) fn sample(_: Option<Waker>) -> Result<mpsc::Receiver<SampleResult>, String> {
    Err("Screen sampling is unavailable on this platform.".into())
}
