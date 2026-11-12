#!/bin/sh
set -eu
project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"
binary="${CARGO_TARGET_DIR:-target}/release/img"
mkdir -p artifacts
"$binary" --scene rotate --snap artifacts/spatial-rotate.png --size 980x820 --scale 1
"$binary" --scene rotate --script __tests__/rotate-drag.json --snap artifacts/spatial-rotate-drag.png --at 0.4 --size 700x400 --scale 1
"$binary" --scene crop --snap artifacts/spatial-crop.png --size 700x400 --scale 1
"$binary" --scene resize --script __tests__/size-drag.json --snap artifacts/spatial-resize-drag.png --at 0.4 --size 980x820 --scale 1
"$binary" --scene numbers --snap artifacts/numbers.png --size 980x820 --scale 1
"$binary" --scene numbers --snap artifacts/numbers-small.png --size 700x400 --scale 1
"$binary" --scene edited --snap artifacts/editor.png --size 980x820 --theme light --scale 1
"$binary" --scene edited --snap artifacts/editor-small.png --size 700x400 --theme dark --scale 1
"$binary" --scene edited --script __tests__/reorder.json --snap artifacts/drag.png --at 0.42 --scale 1
"$binary" --scene caption --at 0.1 --snap artifacts/caption.png --size 980x820 --theme light --scale 1
"$binary" --scene picker --snap artifacts/picker.png --size 700x400 --theme light --scale 1
"$binary" --scene color --at 0.1 --snap artifacts/color-picker.png --size 980x820 --theme light --scale 1
"$binary" --scene color --at 0.1 --snap artifacts/color-picker-small.png --size 700x400 --theme light --scale 1
"$binary" --scene caption --at 0.1 --snap artifacts/caption-small.png --size 700x400 --theme light --scale 1
"$binary" --scene caption --script __tests__/text-drag.json --snap artifacts/text-drag.png --at 0.35 --size 980x820 --scale 1
"$binary" --scene caption --at 0.1 --snap artifacts/caption-retina.png --size 980x820 --theme light --scale 2
"$binary" --scene typography --at 0.1 --snap artifacts/typography.png --size 980x820 --theme light --scale 1
"$binary" --scene typography --at 0.1 --snap artifacts/typography-retina.png --size 980x820 --theme light --scale 2
"$binary" --scene fonts --at 0.8 --snap artifacts/fonts.png --size 980x820 --theme light --scale 1
"$binary" --scene fonts --at 0.8 --snap artifacts/fonts-small.png --size 700x400 --theme light --scale 1
"$binary" --scene fonts --at 0.8 --snap artifacts/fonts-retina.png --size 980x820 --theme light --scale 2
"$binary" --scene editing --at 1 --snap artifacts/editing.png --size 980x820 --theme light --scale 1
"$binary" --scene editing --at 1 --snap artifacts/editing-small.png --size 700x400 --theme light --scale 1
"$binary" --scene editing --at 1 --snap artifacts/editing-retina.png --size 980x820 --theme light --scale 2
for capture in artifacts/spatial-rotate.png artifacts/spatial-rotate-drag.png artifacts/spatial-crop.png artifacts/spatial-resize-drag.png artifacts/numbers.png artifacts/numbers-small.png artifacts/editing.png artifacts/editing-small.png artifacts/editing-retina.png artifacts/fonts-small.png artifacts/fonts-retina.png artifacts/typography.png artifacts/typography-retina.png artifacts/fonts.png artifacts/editor.png artifacts/editor-small.png artifacts/drag.png artifacts/caption.png artifacts/picker.png artifacts/color-picker.png artifacts/color-picker-small.png artifacts/caption-small.png artifacts/text-drag.png artifacts/caption-retina.png; do
    test -s "$capture"
done
