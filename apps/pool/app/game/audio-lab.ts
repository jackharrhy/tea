import { createMatch, type PoolSound, type PhysicalBall } from "@tea/pool";
import { FELT_Y } from "@tea/pool/table";
import type { Snapshot } from "@tea/pool-protocol";
import { RETURN_FLOOR_POINT } from "./audio-surfaces";
import { GameAudio } from "./audio";

if (!import.meta.env.DEV)
  throw new Error("Audio auditioning is available only in local development.");
const audio = new GameAudio();
const status = document.querySelector<HTMLElement>("#status")!;
const enable = document.querySelector<HTMLButtonElement>("#enable")!;
const speed = document.querySelector<HTMLInputElement>("#speed")!;
const direction = document.querySelector<HTMLSelectElement>("#direction")!;
const distance = document.querySelector<HTMLInputElement>("#distance")!;
const rolling = document.querySelector<HTMLSelectElement>("#rolling")!;
const listener = { x: -2.5, y: 1.5, z: -2.7 };
audio.updateListener(listener, { x: 0, y: 0, z: -1 });
audio.onError = (message) => {
  status.textContent = message;
};
enable.addEventListener("click", async () => {
  const enabled = audio.toggle();
  enable.textContent = enabled ? "Mute game audio" : "Enable game audio";
  status.textContent = enabled
    ? "Loading recorded samples…"
    : "Game audio muted.";
  if (enabled) {
    await audio.resume();
    if (status.textContent === "Loading recorded samples…")
      status.textContent =
        "Ready. Compare slow Ball hits, Felt landing, Lower floor, and both rolling beds.";
  }
});
speed.addEventListener("input", () => {
  document.querySelector<HTMLOutputElement>("#speed-value")!.value =
    speed.value;
});
document
  .querySelector<HTMLButtonElement>("#stop")!
  .addEventListener("click", () => {
    rolling.value = "off";
    audio.reset();
  });
function point() {
  const d = Math.max(0.2, Math.min(20, Number(distance.value) || 1));
  return {
    x: direction.value === "left" ? -d : direction.value === "right" ? d : 0,
    y: 0.8,
    z: direction.value === "rear" ? d : direction.value === "front" ? -d : 0,
  };
}
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-kind]",
)) {
  button.addEventListener("click", () =>
    audio.predicted("1", 1, 1, {
      kind: button.dataset.kind as PoolSound["kind"],
      ballId: 1,
      ...point(),
      ...(button.dataset.surface === "floor"
        ? {
            x: RETURN_FLOOR_POINT.x,
            y: RETURN_FLOOR_POINT.y,
            z: RETURN_FLOOR_POINT.z,
          }
        : { y: button.dataset.surface === "felt" ? FELT_Y : point().y }),
      speed: Number(speed.value),
    }),
  );
}
const match = createMatch();
let tick = 0;
const timer = setInterval(() => {
  const ball: PhysicalBall = {
    id: 1,
    ...point(),
    vx: Number(speed.value),
    vy: 0,
    vz: 0,
    q: [0, 0, 0, 1],
    w: [0, 0, 0],
    pocketed: rolling.value === "return",
    stage: rolling.value === "return" ? "return" : "table",
    revision: 0,
  };
  const snapshot: Snapshot = {
    type: "state",
    tick: tick++,
    time: (tick * 1000) / 30,
    players: [],
    tables: [
      {
        id: "1",
        rack: 1,
        match,
        rematchReady: [],
        balls: rolling.value === "off" ? [] : [ball],
        sounds: [],
      },
    ],
  };
  audio.observe(snapshot, "1");
}, 1000 / 30);
window.addEventListener("pagehide", () => {
  clearInterval(timer);
  audio.dispose();
});
