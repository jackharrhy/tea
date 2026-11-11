import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { parseRecording, type GameRecording } from "@harrhy/pool/recording";
import { createTable, FELT_Y } from "./scene/table";
import { createBallMaterials } from "./scene/textures";
import { sampleShot, shotDuration } from "./replay-playback";

if (!import.meta.env.DEV)
  throw new Error("Replay is available only in local development.");
const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const file = element<HTMLInputElement>("file");
const shots = element<HTMLSelectElement>("shot");
const play = element<HTMLButtonElement>("play");
const timeline = element<HTMLInputElement>("timeline");
const speed = element<HTMLSelectElement>("speed");
const status = element<HTMLParagraphElement>("status");
const viewport = element<HTMLDivElement>("viewport");
let recording: GameRecording | undefined;
let shotIndex = 0,
  position = 0,
  playing = false,
  loadId = 0;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111713);
const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 50);
camera.position.set(2.3, 3.2, 2.6);
const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
viewport.prepend(renderer.domElement);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, FELT_Y, 0);
orbit.minDistance = 1;
orbit.maxDistance = 12;
orbit.maxPolarAngle = Math.PI / 2;
orbit.update();
scene.add(new THREE.HemisphereLight(0xffefcf, 0x263529, 0.8));
const fill = new THREE.DirectionalLight(0xffe7c2, 1.2);
fill.position.set(2, 5, 1);
scene.add(fill);
const table = createTable(createBallMaterials());
table.rig.visible = false;
scene.add(table.group);
for (const ball of table.balls) ball.visible = false;
new ResizeObserver(() => {
  const { width, height } = viewport.getBoundingClientRect();
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}).observe(viewport);

function refreshPose() {
  const shot = recording?.shots[shotIndex];
  if (!shot) return;
  for (const ball of table.balls) ball.visible = false;
  for (const pose of sampleShot(shot, position)) {
    const mesh = table.balls[pose.id];
    if (!mesh) continue;
    mesh.visible = true;
    mesh.position.set(pose.x, pose.y, pose.z);
    mesh.quaternion.fromArray(pose.q);
  }
  timeline.value = String(position);
  element<HTMLOutputElement>("time").value =
    `${(position / 1000).toFixed(3)} / ${(shotDuration(shot) / 1000).toFixed(3)} s`;
  play.textContent = playing ? "Pause" : "Play";
}
function chooseShot(index: number) {
  shotIndex = index;
  position = 0;
  const shot = recording!.shots[index]!;
  shots.value = String(index);
  timeline.max = String(shotDuration(shot));
  element("build").textContent =
    `Build ${shot.build.revision} · Bun ${shot.build.bun} · Physics ${shot.build.physics} · ${shot.droppedFrames} dropped frames · ${shot.endReason ?? "No end reason"}`;
  const events = element<HTMLUListElement>("events");
  events.replaceChildren();
  element("event-context").textContent =
    "Select an event to inspect its recorded context.";
  for (const flag of shot.flags) {
    const li = document.createElement("li");
    li.textContent = `Flag: ${flag}`;
    events.append(li);
  }
  for (const event of shot.events) {
    const li = document.createElement("li"),
      button = document.createElement("button");
    button.textContent = `${(event.at / 1000).toFixed(3)} s · ${event.type}${event.ballId === undefined ? "" : ` · Ball ${event.ballId}`} · tick ${event.tick}`;
    button.addEventListener("click", () => {
      playing = false;
      position = Math.max(0, Math.min(event.at, shotDuration(shot)));
      element("event-context").textContent = JSON.stringify(event, null, 2);
      refreshPose();
    });
    li.append(button);
    events.append(li);
  }
  element("event-count").textContent =
    `(${shot.events.length} events, ${shot.flags.length} flags)`;
  refreshPose();
}
async function loadFile(selected: File) {
  const id = ++loadId;
  playing = false;
  refreshPose();
  if (selected.size > 64 * 1024 * 1024) {
    status.textContent = "File exceeds 64 MB. Choose a smaller JSON export.";
    return;
  }
  status.textContent = "Reading local recording…";
  try {
    const parsed = parseRecording(JSON.parse(await selected.text()));
    if (id !== loadId) return;
    recording = parsed;
    shots.replaceChildren(
      ...parsed.shots.map(
        (shot, index) =>
          new Option(
            `Shot ${shot.command.number} · Seat ${shot.command.seat + 1}${shot.command.bot ? " · Bot" : ""}`,
            String(index),
          ),
      ),
    );
    shots.disabled = play.disabled = timeline.disabled = !parsed.shots.length;
    if (parsed.shots.length) chooseShot(0);
    else {
      for (const ball of table.balls) ball.visible = false;
      element("events").replaceChildren();
      element("event-context").textContent = "No events recorded.";
      element("event-count").textContent = "";
      element("build").textContent = "No shots recorded.";
      timeline.value = timeline.max = "0";
      element<HTMLOutputElement>("time").value = "0.000 / 0.000 s";
    }
    status.textContent = `Game ${parsed.game.id} · ${parsed.shots.length} shots · ${selected.name}`;
  } catch (error) {
    if (id === loadId)
      status.textContent = `Cannot read recording: ${error instanceof Error ? error.message : String(error)}. Choose a valid JSON export.`;
  }
}
file.addEventListener("change", () => {
  if (file.files?.[0]) void loadFile(file.files[0]);
});
document.addEventListener("dragover", (event) => {
  event.preventDefault();
});
document.addEventListener("drop", (event) => {
  event.preventDefault();
  const selected = event.dataTransfer?.files[0];
  if (selected) void loadFile(selected);
});
shots.addEventListener("change", () => {
  playing = false;
  chooseShot(Number(shots.value));
});
timeline.addEventListener("input", () => {
  playing = false;
  position = Number(timeline.value);
  refreshPose();
});
play.addEventListener("click", () => {
  const shot = recording?.shots[shotIndex];
  if (!shot) return;
  if (!playing && position >= shotDuration(shot)) position = 0;
  playing = !playing;
  refreshPose();
});
let previous = performance.now();
void renderer
  .init()
  .then(() => {
    renderer.setAnimationLoop(() => {
      const now = performance.now(),
        elapsed = now - previous;
      previous = now;
      if (playing && recording) {
        position += elapsed * Number(speed.value);
        while (position >= shotDuration(recording.shots[shotIndex]!)) {
          const remainder =
            position - shotDuration(recording.shots[shotIndex]!);
          if (shotIndex + 1 >= recording.shots.length) {
            position = shotDuration(recording.shots[shotIndex]!);
            playing = false;
            break;
          }
          chooseShot(shotIndex + 1);
          position = remainder;
        }
        refreshPose();
      }
      renderer.render(scene, camera);
    });
  })
  .catch((error) => {
    status.textContent = `Renderer could not start: ${String(error)}`;
  });
