use super::*;
use crate::MAX_DELAY_MS;
fn delay(milliseconds: u64) -> Result<u32> {
    ensure!(
        milliseconds <= MAX_DELAY_MS as u64,
        "Frame delay would exceed GIF's {MAX_DELAY_MS} ms limit; reduce the hold or increase speed"
    );
    Ok(milliseconds as u32)
}
pub(super) fn apply(op: &Operation, source: &Animation) -> Result<Animation> {
    use Operation::*;
    let mut result = source.clone();
    match *op {
        Reverse => result.frames.reverse(),
        Speed { percent } => {
            for frame in &mut result.frames {
                frame.delay_ms =
                    delay((frame.delay_ms as f64 * 100. / percent as f64).round() as u64)?;
            }
        }
        SetDelay { milliseconds } => {
            for frame in &mut result.frames {
                frame.delay_ms = milliseconds;
            }
        }
        FrameRate { fps } => {
            for (i, frame) in result.frames.iter_mut().enumerate() {
                let boundary = |i: usize| (i as f64 * 100. / fps as f64).round() as u64 * 10;
                frame.delay_ms = delay(boundary(i + 1) - boundary(i))?;
            }
        }
        TrimFrames { first, last } => {
            result.frames = source.frames[first as usize - 1..last as usize].to_vec()
        }
        KeepEvery { step } => {
            result.frames.clear();
            for chunk in source.frames.chunks(step as usize) {
                let mut frame = chunk[0].clone();
                frame.delay_ms = delay(chunk.iter().map(|f| f.delay_ms as u64).sum())?;
                result.frames.push(frame);
            }
        }
        PingPong => {
            if source.frames.len() > 2 {
                result.frames.extend(
                    source.frames[1..source.frames.len() - 1]
                        .iter()
                        .rev()
                        .cloned(),
                );
            }
        }
        RepeatFrames { times } => {
            result.frames = (0..times)
                .flat_map(|_| source.frames.iter().cloned())
                .collect()
        }
        LoopCount { plays } => {
            result.repeat = if plays == 0 {
                gif::Repeat::Infinite
            } else {
                gif::Repeat::Finite((plays - 1) as u16)
            }
        }
        HoldFirst { milliseconds } => {
            let f = &mut result.frames[0];
            f.delay_ms = delay(f.delay_ms as u64 + milliseconds as u64)?;
        }
        HoldLast { milliseconds } => {
            let f = result.frames.last_mut().expect("Validated animation");
            f.delay_ms = delay(f.delay_ms as u64 + milliseconds as u64)?;
        }
        ShiftFrames { offset } => result.frames.rotate_left(offset as usize - 1),
        RemoveDuplicates => {
            result.frames.clear();
            for frame in &source.frames {
                if let Some(previous) = result.frames.last_mut()
                    && previous.pixels == frame.pixels
                    && previous.delay_ms as u64 + frame.delay_ms as u64 <= MAX_DELAY_MS as u64
                {
                    previous.delay_ms += frame.delay_ms;
                } else {
                    result.frames.push(frame.clone());
                }
            }
        }
        _ => unreachable!("Timeline dispatch"),
    }
    Ok(result)
}
