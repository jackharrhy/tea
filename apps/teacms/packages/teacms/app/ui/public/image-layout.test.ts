import { it } from "remix/test";
import * as assert from "remix/assert";
import {
  imageStyle,
  imageGroupStyle,
  decoratedPhotoStyle,
  adornmentStyle,
  localPointerDelta,
} from "./image-layout.ts";

it("shares photo/group styling and converts pointer movement into a scaled, tilted image", () => {
  const props = {
    width: "80%",
    height: "400px",
    rotation: 12,
    border: "3px dashed #112233",
    padding: "10px",
  };
  assert.equal(imageStyle(props).border, props.border);
  assert.equal(imageGroupStyle(props).transform, "rotate(12deg)");
  assert.equal(decoratedPhotoStyle(props).border, props.border);
  assert.equal(
    adornmentStyle({ height: "2rem", left: "10%", rotation: -25 }).transform,
    "rotate(-25deg)",
  );
  const delta = localPointerDelta(20, 0, 90, 0.5);
  assert.ok(Math.abs(delta.x) < 0.00001);
  assert.equal(delta.y, -40);
});
