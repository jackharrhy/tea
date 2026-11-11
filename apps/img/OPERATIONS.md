# Operations

66 operations; up to 64 cards in one stack. Use **Add operation** to search by name or category. Valid field edits apply after a short pause or on blur; Enter applies immediately. Captions support Shift+Enter for new lines. Defaults for crop, frame ranges, fades, and captions adapt to the current animation.

Generated from the same registry as the editor: `cargo run --locked --example operation_reference > OPERATIONS.md`. Numeric ranges below are inclusive; crop rectangles and frame ranges must also fit their input. Operations can fail before rendering when dimensions, frames, delays, or retained pixels would exceed the limits in README.

## Animation

<!-- prettier-ignore -->
| Operation | Parameters | Behavior |
| --- | --- | --- |
| Reverse | — | Reverse the frame order. |
| Speed | Speed (%): 1–10000 (default 200) | 100% keeps the speed; 200% plays twice as fast. |
| Set frame delay | Delay (ms): 0–655350 (default 100) | Give every frame the same delay. |
| Set frame rate | Frames per second: 1–100 (default 15) | Retime the existing frames; distribute GIF's 10 ms timing steps evenly. |
| Trim frame range | First frame: 1–1000 (default 1); Last frame: 1–1000 (default 10) | Keep a range of frames, including both endpoints. |
| Reduce frame count | Keep every Nth frame: 1–1000 (default 2) | Keep the first and every Nth frame; add skipped delays to preserve duration. |
| Ping-pong | — | Play forward, then backward, without repeating the endpoint frames. |
| Repeat sequence | Copies: 1–1000 (default 2) | Concatenate copies of the frame sequence. |
| Loop count | Plays (0 = forever): 0–65536 (default 0) | Set playback metadata. The editor's preview continues to loop. |
| Hold first frame | Extra hold (ms): 0–655350 (default 500) | Add a pause at the beginning. |
| Hold last frame | Extra hold (ms): 0–655350 (default 500) | Add a pause at the end. |
| Shift starting frame | Start at frame: 1–1000 (default 1) | Choose the first frame; wrap the preceding frames to the end. |
| Merge duplicate frames | — | Merge identical consecutive frames while preserving their combined delay. |
| Fade in | Fade frames: 1–1000 (default 8); Red: 0–255 (default 0); Green: 0–255 (default 0); Blue: 0–255 (default 0) | Blend the opening frames from a solid color, preserving alpha. |
| Fade out | Fade frames: 1–1000 (default 8); Red: 0–255 (default 0); Green: 0–255 (default 0); Blue: 0–255 (default 0) | Blend the closing frames toward a solid color, preserving alpha. |

## Color

<!-- prettier-ignore -->
| Operation | Parameters | Behavior |
| --- | --- | --- |
| Negate | — | Invert colors. |
| Grayscale | — | Convert colors to luminance. |
| Sepia | — | Apply a warm sepia tone. |
| Brightness | Amount: -255–255 (default 20) | Add or subtract from the RGB channels. |
| Contrast | Amount (%): -100–100 (default 20) | Expand or compress color values around mid-gray. |
| Gamma | Gamma: 0.1–5 (default 1.2) | Adjust midtones; values above 1 brighten them. |
| Saturation | Saturation (%): 0–400 (default 150) | 100% keeps the colors; 0% removes saturation. |
| Hue | Hue shift (degrees): -360–360 (default 30) | Rotate hue around the color wheel. |
| Exposure | Exposure (stops): -5–5 (default 1) | Adjust exposure in linear light; +1 stop doubles the light. |
| Color balance | Red offset: -255–255 (default 10); Green offset: -255–255 (default 0); Blue offset: -255–255 (default -10) | Adjust each RGB channel independently. |
| Color tint | Red: 0–255 (default 255); Green: 0–255 (default 180); Blue: 0–255 (default 80); Strength (%): 0–100 (default 25) | Blend a solid color into the image. |
| Black and white | Threshold: 0–255 (default 128) | Turn luminance into black or white at a threshold. |
| Posterize | Levels per channel: 2–256 (default 4) | Reduce the number of color levels in each channel. |
| Solarize | Threshold: 0–255 (default 128) | Invert channel values above the threshold. |
| Auto levels | — | Stretch each channel using visible colors across the whole animation to avoid frame-to-frame flicker. |
| Limit palette | Palette colors: 2–256 (default 64) | Map all frames to a shared palette while preserving alpha. |

## Effects

<!-- prettier-ignore -->
| Operation | Parameters | Behavior |
| --- | --- | --- |
| Gaussian blur | Radius (sigma): 0.1–20 (default 1.5) | Blur in premultiplied alpha to avoid dark transparent edges. |
| Sharpen | Radius (sigma): 0.1–10 (default 1); Threshold: 0–255 (default 3) | Apply an unsharp mask without changing alpha. |
| Pixelate | Block size (px): 1–256 (default 8) | Reduce resolution and scale back with nearest-neighbor sampling. |
| Detect edges | — | Show Sobel luminance edges on black. |
| Emboss | Strength: 0–5 (default 1) | Shade directional differences around mid-gray. |
| Add noise | Amount: 0–255 (default 20); Seed: 0–4294967295 (default 1) | Add reproducible RGB noise; the same seed gives the same result. |
| Ordered dither | Levels per channel: 2–6 (default 3) | Reduce colors with a stable 4×4 Bayer pattern. |
| Error diffusion dither | Levels per channel: 2–6 (default 3) | Reduce colors with Floyd–Steinberg error diffusion. |
| Vignette | Strength (%): 0–100 (default 60) | Darken the corners with a soft radial falloff. |
| Scanlines | Line spacing (px): 2–64 (default 3); Darkening (%): 0–100 (default 40) | Darken evenly spaced horizontal rows. |
| Swirl | Twist (degrees): -720–720 (default 120) | Twist around the center, fading the distortion toward the edges. |
| Wave | Amplitude (px): 0–256 (default 8); Wavelength (px): 1–4096 (default 80) | Shift rows in a sine wave on the existing canvas; exposed pixels are transparent. |

## Overlay

<!-- prettier-ignore -->
| Operation | Parameters | Behavior |
| --- | --- | --- |
| Text caption | Caption: up to 1000 characters; Left (px): -4096–4096 (default 16); Top (px): -4096–4096 (default 16); Font size (px): 8–256 (default 24); Red: 0–255 (default 255); Green: 0–255 (default 255); Blue: 0–255 (default 255); Black outline (px): 0–8 (default 1); Font: up to 256 characters; Letter spacing (px): -8–32 (default 0); Line spacing (%): 50–300 (default 100); Line alignment: 0–2 (default 0) | Draw text using bundled or installed fonts. Shift+Enter adds a line. |
| Image / GIF overlay | Image file: up to 4096 characters; Left (px): -4096–4096 (default 0); Top (px): -4096–4096 (default 0); Width (0 = original): 0–4096 (default 0); Opacity (%): 0–100 (default 100) | Choose a PNG, JPEG, or GIF. Merge animation timing; overlays repeat over the source duration. |

## Size & shape

<!-- prettier-ignore -->
| Operation | Parameters | Behavior |
| --- | --- | --- |
| Resize | Width (px): 1–4096 (default 320); Height (px): 1–4096 (default 240) | Set width and height independently. |
| Fit inside box | Max width (px): 1–4096 (default 320); Max height (px): 1–4096 (default 240) | Resize within a box, keeping the aspect ratio. |
| Fill and crop | Width (px): 1–4096 (default 320); Height (px): 1–4096 (default 240) | Fill a box, keeping the aspect ratio; crop the excess from the center. |
| Crop | Left (px): 0–4095 (default 0); Top (px): 0–4095 (default 0); Width (px): 1–4096 (default 160); Height (px): 1–4096 (default 120) | Keep a rectangle inside every frame. |
| Canvas size | Width (px): 1–4096 (default 480); Height (px): 1–4096 (default 360) | Center frames on a transparent canvas; a smaller canvas crops them. |
| Solid border | Width (px): 0–2048 (default 8); Red: 0–255 (default 255); Green: 0–255 (default 255); Blue: 0–255 (default 255) | Add a solid border around every frame. |
| Rotate | Angle (degrees): -360–360 (default 15) | Rotate clockwise on an expanded transparent canvas. |
| Rotate 90° clockwise | — | Turn every frame a quarter turn clockwise. |
| Rotate 180° | — | Turn every frame upside down. |
| Rotate 90° counterclockwise | — | Turn every frame a quarter turn counterclockwise. |
| Flip horizontally | — | Mirror left and right. |
| Flip vertically | — | Mirror top and bottom. |
| Transpose | — | Reflect across the top-left to bottom-right diagonal. |
| Wraparound shift | Horizontal shift (px): -4096–4096 (default 16); Vertical shift (px): -4096–4096 (default 0) | Move pixels with wraparound at the edges. |
| Trim transparent edges | — | Use the union of visible content across all frames, keeping the animation aligned. |

## Transparency

<!-- prettier-ignore -->
| Operation | Parameters | Behavior |
| --- | --- | --- |
| Opacity | Opacity (%): 0–100 (default 50) | Scale alpha. Add Matte to bake partial opacity into GIF colors; GIF alone has binary transparency. |
| Matte background | Red: 0–255 (default 255); Green: 0–255 (default 255); Blue: 0–255 (default 255) | Flatten transparency onto a solid color. |
| Color to transparency | Red: 0–255 (default 255); Green: 0–255 (default 255); Blue: 0–255 (default 255); Color tolerance: 0–255 (default 16) | Make matching colors transparent; tolerance is the maximum difference in any RGB channel. |
| Threshold transparency | Alpha threshold: 0–255 (default 128) | Turn partial alpha into fully transparent or opaque pixels. |
| Show alpha mask | — | Show alpha as an opaque grayscale image. |
| Round corners | Corner radius (px): 0–2048 (default 16) | Mask the corners with antialiased transparency. |

## Export and overlays

GIF has binary transparency. Use **Matte background** to bake partial opacity, antialiased text, or rounded edges into a background color before exporting. Otherwise nonzero alpha becomes opaque. **Limit palette** computes one palette across the animation; GIF export still writes a local palette for each frame.

Overlays accept PNG, JPEG, and GIF files. An empty path or zero opacity bypasses compositing. Width 0 uses original dimensions; other widths preserve aspect ratio. Animated overlays repeat over one source cycle, merging both sets of frame boundaries. Zero-delay frames use 10 ms during this synchronization. The source loop setting is retained.

Captions support bundled and installed fonts; see assets/fonts/README.md for the bundled font licenses. Text is rasterized locally with kerning and line breaks; complex script shaping is not implemented.

## Research

The catalog was informed by the tools offered in [Ezgif](https://ezgif.com/effects), the [ImageMagick operator reference](https://imagemagick.org/command-line-options/), and [Gifsicle's manual](https://www.lcdf.org/gifsicle/man.html). Implementations here run in Rust and are not intended to produce identical pixels to those tools.
