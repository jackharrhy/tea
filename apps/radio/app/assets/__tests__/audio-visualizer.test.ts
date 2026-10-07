import * as assert from "remix/assert";
import { it } from "remix/test";

import { sampleMirroredSpectrum } from "../audio-visualizer.tsx";

it("maps logarithmic frequency bands symmetrically from the center", () => {
  let frequencyData = Uint8Array.from(
    { length: 512 },
    (_, index) => (index * 31) % 256,
  );
  let spectrum = sampleMirroredSpectrum(frequencyData, 48_000, 1024, 48);

  assert.equal(spectrum.length, 48);
  for (let index = 0; index < spectrum.length / 2; index++) {
    assert.equal(spectrum[index], spectrum[spectrum.length - 1 - index]);
  }
});

it("places bass near the center and treble near the outside edges", () => {
  let bass = new Uint8Array(512);
  bass.fill(255, 1, 5);
  let bassSpectrum = sampleMirroredSpectrum(bass, 48_000, 1024, 48);

  let treble = new Uint8Array(512);
  treble.fill(255, 220, 300);
  let trebleSpectrum = sampleMirroredSpectrum(treble, 48_000, 1024, 48);

  assert.ok(bassSpectrum[23]! > bassSpectrum[0]!);
  assert.ok(trebleSpectrum[0]! > trebleSpectrum[23]!);
});
