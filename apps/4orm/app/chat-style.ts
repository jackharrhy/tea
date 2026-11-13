// Match Python Random(int).choice so the source's five-minute chat badge
// stays visually identical across both implementations.
function choices(seed: number) {
  const state = new Uint32Array(624);
  state[0] = 19650218;
  for (let i = 1; i < 624; i++)
    state[i] = Math.imul(1812433253, state[i - 1] ^ (state[i - 1] >>> 30)) + i;
  let i = 1;
  for (let k = 624; k; k--) {
    state[i] =
      (state[i] ^ Math.imul(state[i - 1] ^ (state[i - 1] >>> 30), 1664525)) +
      seed;
    if (++i === 624) {
      state[0] = state[623];
      i = 1;
    }
  }
  for (let k = 623; k; k--) {
    state[i] =
      (state[i] ^ Math.imul(state[i - 1] ^ (state[i - 1] >>> 30), 1566083941)) -
      i;
    if (++i === 624) {
      state[0] = state[623];
      i = 1;
    }
  }
  state[0] = 0x80000000;
  let index = 624;
  function next() {
    if (index === 624) {
      for (let k = 0; k < 624; k++) {
        const value =
          (state[k] & 0x80000000) | (state[(k + 1) % 624] & 0x7fffffff);
        state[k] =
          state[(k + 397) % 624] ^ (value >>> 1) ^ (value & 1 ? 0x9908b0df : 0);
      }
      index = 0;
    }
    let value = state[index++];
    value ^= value >>> 11;
    value ^= (value << 7) & 0x9d2c5680;
    value ^= (value << 15) & 0xefc60000;
    value ^= value >>> 18;
    return value >>> 0;
  }
  return <T>(values: T[]) => {
    const bits = values.length.toString(2).length;
    let selected = next() >>> (32 - bits);
    while (selected >= values.length) selected = next() >>> (32 - bits);
    return values[selected];
  };
}
export function chatStyle(timestamp = Date.now()) {
  const pick = choices(Math.floor(timestamp / 300_000));
  const fonts = [
    "monospace",
    "cursive",
    "fantasy",
    "serif",
    "Comic Sans MS, cursive",
  ];
  const colors = [
    "#ff0000",
    "#00ff00",
    "#0000ff",
    "#ff00ff",
    "#ffff00",
    "#00ffff",
    "#ff6600",
    "#66ff33",
  ];
  const backgrounds = [
    "#000",
    "#111",
    "#220022",
    "#002200",
    "#000033",
    "#330000",
    "#1a1a2e",
  ];
  const borders = [
    "3px solid",
    "3px dashed",
    "3px double",
    "3px dotted",
    "3px outset",
    "3px ridge",
  ];
  return {
    fontFamily: pick(fonts),
    color: pick(colors),
    background: pick(backgrounds),
    border: pick(borders) + " " + pick(colors),
    padding: "6px 16px",
    textDecoration: "none",
    display: "inline-block",
  };
}
