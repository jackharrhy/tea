#[test]
fn headless_sample_and_smoke_export_real_gifs() {
    let dir = tempfile::tempdir().unwrap();
    let sample = dir.path().join("sample.gif");
    let output = dir.path().join("output.gif");
    let result = std::process::Command::new(env!("CARGO_BIN_EXE_img"))
        .args(["--generate-sample", sample.to_str().unwrap()])
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let result = std::process::Command::new(env!("CARGO_BIN_EXE_img"))
        .args([
            "--smoke",
            sample.to_str().unwrap(),
            output.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let source = img::Animation::load(&sample).unwrap();
    let decoded = img::Animation::load(&output).unwrap();
    assert_eq!(source.frames.len(), decoded.frames.len());
    assert_eq!(decoded.frames[0].pixels.dimensions(), (160, 120));
    assert_eq!(
        decoded.frames[0].delay_ms,
        source.frames.last().unwrap().delay_ms
    );
    assert_eq!(decoded.repeat, source.repeat);
}
