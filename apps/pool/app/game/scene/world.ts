import * as THREE from "three/webgpu";
import { CollisionDebug } from "./collision-debug";
import { createTable, BALL_Y } from "./table";
import { fixtureOpacity } from "./fixture-visibility";
import { viewportVignette, pendantRig } from "./lighting";
import { cuePose, CUE_CONTACT_MS, CUE_LENGTH, CUE_RADIUS } from "./cue-pose";
import { createHall } from "./hall";
import { createAvatar, disposeAvatar, poseAvatar } from "./avatar";
import { createBallMaterials, material, plaque, tableStatus } from "./textures";
import { createSmoke } from "./smoke";
import type { MotionEntity } from "../prediction/net-state";
import { ViewCamera } from "./view-camera";
import { TablePresence, type LocalPlacement } from "./table-presence";
import { TABLES, AVATAR_SCALE } from "@tea/pool-simulation/geometry";
import {
  BALL_RADIUS,
  TABLE_HALF_WIDTH as W,
  TABLE_HALF_LENGTH as L,
} from "@tea/pool";
import { FELT_Y, RAIL_WIDTH, RAIL_TOP_Y } from "@tea/pool/table";
import type { PlayerState, TableState, RoomSettings } from "@tea/pool-protocol";
export class HallView {
  readonly renderer: THREE.WebGPURenderer;
  private vignette = viewportVignette();
  private cameraRig: ViewCamera;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(43, 1, 0.1, 100);
  readonly raycaster = new THREE.Raycaster();
  readonly pointer = new THREE.Vector2();
  readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  readonly felt = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BALL_Y);
  readonly tables = new Map<string, THREE.Group>();
  private seats: THREE.Mesh[] = [];
  readonly avatars = new Map<string, THREE.Group>();
  readonly ballMeshes = new Map<string, THREE.Mesh[]>();
  readonly tableLabels = new Map<string, ReturnType<typeof plaque>>();
  readonly guide: THREE.Line;
  readonly ghost: THREE.Mesh;
  readonly cue = new THREE.Group();
  private tablePresence: TablePresence;
  readonly cursor: THREE.Mesh;
  private ballMaterials: THREE.MeshStandardMaterial[];
  private target = new THREE.Vector3(0, 0, 1);
  private lastTableLabels = new Map<string, string>();
  private statusSigns = new Map<string, ReturnType<typeof tableStatus>>();
  private lastStatus = new Map<string, string>();
  private fixtures: {
    id: string;
    rig: THREE.Group;
    visibility: ReturnType<typeof pendantRig>["fixtures"][number]["visibility"];
    bounds: THREE.Box3[];
  }[] = [];
  private focusedTable: string | null = null;
  private cuePull = 0;
  private cueStroke: {
    at: number;
    table: string;
    angle: number;
    pull: number;
    ball: { x: number; z: number };
    shown: boolean;
  } | null = null;
  private walls: { group: THREE.Group; x: number; z: number }[] = [];
  private shadowLights = new Map<string, THREE.SpotLight>();
  private roomLights = new Map<THREE.Light, number>();
  private cutaways: ((enabled: boolean) => void)[] = [];
  private collisionDebug?: CollisionDebug;
  private updateSmoke: ReturnType<typeof createSmoke>;
  constructor(readonly canvas: HTMLCanvasElement) {
    const debug = new URLSearchParams(location.search).has("debug");
    this.renderer = new THREE.WebGPURenderer({
      canvas,
      antialias: true,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = !debug;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.scene.background = new THREE.Color(0x120e0b);
    this.scene.fog = debug ? null : new THREE.FogExp2(0x2d2118, 0.018);
    this.scene.add(new THREE.AmbientLight(0xffce92, 0.38));
    this.scene.add(new THREE.HemisphereLight(0xffc98c, 0x523626, 1.25));
    for (const [x, z] of [
      [-4, -5],
      [4, 5],
    ]) {
      const glow = new THREE.PointLight(0xff963f, 18, 9, 2);
      glow.position.set(x, 2.4, z);
      this.scene.add(glow);
    }
    this.ballMaterials = createBallMaterials();
    const hall = createHall();
    this.scene.add(hall.group);
    this.walls = hall.walls;
    this.seats = hall.seats;
    for (const table of TABLES) this.buildTable(table.id, table.x, table.z);
    this.scene.traverse((object) => {
      if (object instanceof THREE.Light)
        this.roomLights.set(object, object.intensity);
    });
    this.updateSmoke = debug ? () => {} : createSmoke(this.scene);
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(),
    ]);
    this.guide = new THREE.Line(
      geometry,
      new THREE.LineDashedMaterial({
        color: 0xe8ecd5,
        dashSize: 0.09,
        gapSize: 0.06,
        transparent: true,
        opacity: 0.8,
      }),
    );
    this.scene.add(this.guide);
    this.ghost = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_RADIUS, 16, 12),
      new THREE.MeshBasicMaterial({
        color: 0xecedcf,
        wireframe: true,
        transparent: true,
        opacity: 0.65,
      }),
    );
    this.scene.add(this.ghost);
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0065, 0.012, CUE_LENGTH - 0.43, 10),
      material(0xd8b77c),
    );
    shaft.rotation.z = -Math.PI / 2;
    shaft.position.x = -0.03 - (CUE_LENGTH - 0.43) / 2;
    this.cue.add(shaft);
    const ferrule = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0065, 0.0065, 0.026, 10),
      material(0xf0e8cf),
    );
    ferrule.rotation.z = -Math.PI / 2;
    ferrule.position.x = -0.017;
    this.cue.add(ferrule);
    const tip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0065, 0.0065, 0.004, 10),
      material(0x537a80),
    );
    tip.rotation.z = -Math.PI / 2;
    tip.position.x = -0.002;
    this.cue.add(tip);
    const grip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, CUE_RADIUS, 0.4, 10),
      material(0x4d3024),
    );
    grip.rotation.z = -Math.PI / 2;
    grip.position.x = -CUE_LENGTH + 0.2;
    this.cue.add(grip);
    this.scene.add(this.cue);
    this.tablePresence = new TablePresence(
      this.tables,
      this.ballMeshes,
      this.cue,
      (id) => {
        this.shadowLights.get(id)!.shadow.needsUpdate = true;
      },
    );
    this.cursor = new THREE.Mesh(
      new THREE.RingGeometry(0.16, 0.2, 32),
      new THREE.MeshBasicMaterial({
        color: 0xc3d9a6,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
      }),
    );
    this.cursor.rotation.x = -Math.PI / 2;
    this.cursor.visible = false;
    this.scene.add(this.cursor);
    if (debug)
      this.collisionDebug = new CollisionDebug(
        this.scene,
        this.tables,
        this.ballMeshes,
        hall.group,
      );
    this.camera.position.set(6.5, 9.4, 9.4);
    this.camera.lookAt(0, 0.5, 0);
    this.cameraRig = new ViewCamera(this.camera);
    this.setAim(null, 0, 0.65, false);
    this.resize();
  }
  private buildTable(id: string, x: number, z: number) {
    const { group, balls, fixtures, light, setCutaway } = createTable(
      this.ballMaterials,
    );
    group.position.set(x, 0, z);
    this.scene.add(group);
    this.tables.set(id, group);
    this.cutaways.push(setCutaway);
    group.updateMatrixWorld(true);
    for (const { rig, visibility } of fixtures) {
      const bounds: THREE.Box3[] = [];
      rig.traverse((part) => {
        if (part instanceof THREE.Mesh)
          bounds.push(new THREE.Box3().setFromObject(part));
      });
      this.fixtures.push({ id, rig, visibility, bounds });
    }
    this.shadowLights.set(id, light);
    const tableLabel = plaque(`Table ${id}`, W * 1.6);
    tableLabel.position.set(0, FELT_Y - 0.12, L + RAIL_WIDTH + 0.005);
    group.add(tableLabel);
    this.tableLabels.set(id, tableLabel);
    const status = tableStatus("");
    status.rotation.x = -Math.PI / 2;
    status.scale.set((W * 1.8) / 1.85, (RAIL_WIDTH * 0.8) / 0.25, 1);
    status.position.set(0, RAIL_TOP_Y + 0.004, -L - RAIL_WIDTH / 2);
    group.add(status);
    this.statusSigns.set(id, status);
    this.ballMeshes.set(id, balls);
  }
  applyRoomSettings(settings: RoomSettings) {
    for (const [light, intensity] of this.roomLights)
      light.intensity = intensity * settings.lightIntensity;
    for (const setCutaway of this.cutaways) setCutaway(settings.cutaway);
    for (const sign of this.statusSigns.values())
      sign.position.y = RAIL_TOP_Y + 0.004 + (settings.cutaway ? 1 : 0);
    for (const light of this.shadowLights.values())
      light.shadow.needsUpdate = true;
  }
  async init() {
    await this.renderer.init();
    await this.renderer.compileAsync(this.scene, this.camera);
    await this.renderer.compileAsync(this.vignette.scene, this.vignette.camera);
    console.info("8ball renderer:", this.renderer.backend.constructor.name);
  }
  async dispose() {
    this.renderer.setAnimationLoop(null);
    this.tablePresence.dispose();
    this.collisionDebug?.dispose();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    for (const scene of [this.scene, this.vignette.scene])
      scene.traverse((object) => {
        if (
          object instanceof THREE.Mesh ||
          object instanceof THREE.Line ||
          object instanceof THREE.Sprite
        ) {
          if (
            "geometry" in object &&
            object.geometry instanceof THREE.BufferGeometry
          )
            geometries.add(object.geometry);
          for (const item of Array.isArray(object.material)
            ? object.material
            : [object.material]) {
            if (!(item instanceof THREE.Material)) continue;
            materials.add(item);
            for (const value of Object.values(item))
              if (value instanceof THREE.Texture) textures.add(value);
          }
        }
      });
    for (const sceneMaterial of this.ballMaterials) {
      materials.add(sceneMaterial);
      if (sceneMaterial.map) textures.add(sceneMaterial.map);
    }
    for (const texture of textures) texture.dispose();
    for (const sceneMaterial of materials) sceneMaterial.dispose();
    for (const geometry of geometries) geometry.dispose();
    for (const light of this.shadowLights.values()) light.shadow.dispose();
    await this.renderer.dispose();
  }
  zoomBy(delta: number) {
    this.cameraRig.zoomBy(delta);
  }
  orbitBy(dx: number, dy: number) {
    this.cameraRig.orbitBy(dx, dy);
  }
  panBy(dx: number, dy: number) {
    this.cameraRig.panBy(dx, dy, innerHeight);
  }
  recenter() {
    this.cameraRig.recenter();
  }
  movement(horizontal: number, vertical: number) {
    return this.cameraRig.movement(horizontal, vertical);
  }
  syncTables(tables: TableState[], players: PlayerState[], self: string) {
    for (const table of tables) {
      const balls = this.ballMeshes.get(table.id)!;
      for (const ball of table.balls) {
        const mesh = balls[ball.id];
        if (mesh) mesh.userData.pocketed = ball.pocketed;
      }
      const active = players.find(
        (p) => p.id === table.match.players[table.match.turn],
      );
      const winner = players.find((p) => p.id === table.match.winner);
      const group = table.match.groups[table.match.turn];
      const remaining = table.balls.filter(
        (ball) =>
          !ball.pocketed &&
          (group === "solid"
            ? ball.id >= 1 && ball.id <= 7
            : group === "stripe"
              ? ball.id >= 9
              : false),
      ).length;
      const groupText = group
        ? `${group === "solid" ? "Solids" : "Stripes"} · ${remaining}`
        : "";
      const status =
        table.match.phase === "waiting"
          ? `Table ${table.id}`
          : table.match.phase === "finished"
            ? `${winner?.name ?? "Opponent"} wins`
            : table.match.phase === "ball-in-hand"
              ? active?.id === self
                ? "Place cue ball"
                : "Ball in hand"
              : table.match.phase === "rolling"
                ? ""
                : active?.id === self
                  ? groupText || "Your turn"
                  : groupText || "Open table";
      if (this.lastStatus.get(table.id) !== status) {
        const old = this.statusSigns.get(table.id)!;
        const next = tableStatus(status);
        next.position.copy(old.position);
        next.rotation.copy(old.rotation);
        next.scale.copy(old.scale);
        old.parent!.add(next);
        old.removeFromParent();
        old.material.map!.dispose();
        old.material.dispose();
        old.geometry.dispose();
        this.statusSigns.set(table.id, next);
        this.lastStatus.set(table.id, status);
      }
      const text = `Table ${table.id} · ${players.some((p) => p.bot && p.table === table.id) ? "House bot" : `${table.match.players.filter(Boolean).length}/2`}`;
      if (this.lastTableLabels.get(table.id) !== text) {
        const old = this.tableLabels.get(table.id)!;
        const next = plaque(text, W * 1.6);
        next.position.copy(old.position);
        old.parent!.add(next);
        old.parent!.remove(old);
        (old.material.map as THREE.Texture).dispose();
        old.material.dispose();
        old.geometry.dispose();
        this.tableLabels.set(table.id, next);
        this.lastTableLabels.set(table.id, text);
      }
    }
  }
  syncPlayers(players: PlayerState[], self: string, tables: TableState[]) {
    const ids = new Set(players.map((p) => p.id));
    for (const [id, avatar] of this.avatars)
      if (!ids.has(id)) {
        disposeAvatar(avatar);
        for (const light of this.shadowLights.values())
          light.shadow.needsUpdate = true;
        this.avatars.delete(id);
      }
    for (const player of players) {
      let avatar = this.avatars.get(player.id);
      if (!avatar) {
        for (const light of this.shadowLights.values())
          light.shadow.needsUpdate = true;
        avatar = createAvatar(player);
        avatar.position.set(player.x, 0, player.z);
        this.scene.add(avatar);
        this.avatars.set(player.id, avatar);
      }
      if (avatar.userData.player?.color !== player.color) {
        for (const child of avatar.children)
          if (
            (child.name === "robe" || child.name === "hat") &&
            child instanceof THREE.Mesh
          )
            (child.material as THREE.MeshStandardMaterial).color.setHex(
              player.color,
            );
      }
      if (avatar.userData.player?.seat !== player.seat)
        for (const light of this.shadowLights.values())
          light.shadow.needsUpdate = true;
      avatar.userData.player = player;
      poseAvatar(avatar, player.seat);
      avatar.userData.self = player.id === self;
      const active = tables.some(
        (t) =>
          (t.match.phase === "aiming" || t.match.phase === "ball-in-hand") &&
          t.match.players[t.match.turn] === player.id,
      );
      const ring = avatar.getObjectByName("turn-ring") as THREE.Mesh<
        THREE.RingGeometry,
        THREE.MeshBasicMaterial
      >;
      ring.visible = active || player.id === self;
      ring.material.color.set(active ? 0xe6c47d : player.color);
      ring.material.opacity = active ? 0.95 : 0.3;
    }
  }
  applyMotion(
    poses: MotionEntity[],
    self: string,
    local: { x: number; z: number } | null,
    localYaw: number,
  ) {
    for (const pose of poses) {
      if (pose.id.startsWith("player:")) {
        const id = pose.id.slice(7);
        const avatar = this.avatars.get(id);
        if (!avatar || (id === self && local)) continue;
        if (
          Math.hypot(avatar.position.x - pose.x, avatar.position.z - pose.z) >
          0.003
        )
          for (const light of this.shadowLights.values())
            light.shadow.needsUpdate = true;
        avatar.position.set(pose.x, pose.y, pose.z);
        if (pose.yaw !== undefined && !avatar.userData.player?.seat)
          avatar.rotation.y = pose.yaw;
      } else {
        const [, table, id] = pose.id.split(":");
        const ball = this.ballMeshes.get(table)?.[Number(id)];
        if (!ball) continue;
        if (
          ball.position.x !== pose.x ||
          ball.position.y !== pose.y ||
          ball.position.z !== pose.z
        )
          this.shadowLights.get(table)!.shadow.needsUpdate = true;
        ball.position.set(pose.x, pose.y, pose.z);
        if (pose.q) ball.quaternion.set(pose.q.x, pose.q.y, pose.q.z, pose.q.w);
      }
    }
    const avatar = this.avatars.get(self);
    if (avatar && local) {
      if (
        Math.hypot(avatar.position.x - local.x, avatar.position.z - local.z) >
        0.003
      )
        for (const light of this.shadowLights.values())
          light.shadow.needsUpdate = true;
      avatar.position.set(local.x, 0, local.z);
      if (!avatar.userData.player?.seat) avatar.rotation.y = localYaw;
    }
  }
  containsPoint(x: number, y: number) {
    const rect = { x: 0, y: 0, width: innerWidth, height: innerHeight };
    return (
      x >= rect.x &&
      x <= rect.x + rect.width &&
      y >= rect.y &&
      y <= rect.y + rect.height
    );
  }
  hit(clientX: number, clientY: number, onTable = false) {
    const rect = { x: 0, y: 0, width: innerWidth, height: innerHeight };
    if (!this.containsPoint(clientX, clientY)) return null;
    this.pointer.set(
      ((clientX - rect.x) / rect.width) * 2 - 1,
      (-(clientY - rect.y) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const target = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(
      onTable ? this.felt : this.ground,
      target,
    );
  }
  hitSeat(clientX: number, clientY: number): string | null {
    if (!this.containsPoint(clientX, clientY)) return null;
    this.pointer.set(
      (clientX / innerWidth) * 2 - 1,
      -(clientY / innerHeight) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    for (const seat of this.seats) seat.updateWorldMatrix(true, false);
    const hit = this.raycaster.intersectObjects(this.seats, false)[0];
    return hit?.object.userData.seat ?? null;
  }
  shotDirection(tableId: string, angle: number) {
    const cue = this.ballMeshes.get(tableId)?.[0];
    const table = this.tables.get(tableId);
    if (!cue || !table) return null;
    const start = cue.position.clone().add(table.position);
    const end = start
      .clone()
      .add(new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)));
    start.project(this.camera);
    end.project(this.camera);
    const x = ((end.x - start.x) * innerWidth) / 2;
    const y = (-(end.y - start.y) * innerHeight) / 2;
    return Math.hypot(x, y) > 0.01 ? { x, y } : null;
  }
  strikeCue(table: string, angle: number, now: number) {
    const ball = this.ballMeshes.get(table)?.[0];
    if (ball)
      this.cueStroke = {
        at: now,
        table,
        angle,
        pull: this.cuePull,
        ball: { x: ball.position.x, z: ball.position.z },
        shown: false,
      };
  }
  cancelCueStrike() {
    this.cueStroke = null;
    this.cuePull = 0;
  }
  private placeCue(
    table: string,
    ball: { x: number; z: number },
    angle: number,
    pull: number,
    contact = false,
  ) {
    const group = this.tables.get(table)!;
    const pose = cuePose(ball, angle, pull, contact);
    this.cue.position.fromArray(pose.position).add(group.position);
    this.cue.quaternion.setFromUnitVectors(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(...pose.axis),
    );
  }
  setAim(
    tableId: string | null,
    angle: number,
    power: number,
    visible: boolean,
    dt = 1 / 60,
    now = performance.now(),
  ) {
    if (this.cueStroke?.shown && now - this.cueStroke.at > 120)
      this.cueStroke = null;
    const stroke = this.cueStroke;
    this.guide.visible = this.ghost.visible = visible && !stroke;
    this.cue.visible = visible || !!stroke;
    if (stroke) {
      stroke.shown = true;
      const progress = Math.min(
        1,
        Math.max(0, (now - stroke.at) / CUE_CONTACT_MS),
      );
      this.placeCue(
        stroke.table,
        stroke.ball,
        stroke.angle,
        stroke.pull * (1 - progress) ** 2,
        progress === 1,
      );
      return;
    }
    if (!tableId || !visible) {
      this.cuePull = 0;
      return;
    }
    this.cuePull = THREE.MathUtils.damp(this.cuePull, power, 40, dt);
    const group = this.tables.get(tableId)!,
      balls = this.ballMeshes.get(tableId)!,
      cue = balls[0];
    const dx = Math.cos(angle),
      dz = Math.sin(angle);
    let distance = 6;
    for (const ball of balls.slice(1))
      if (!ball.userData.pocketed && ball.position.y > BALL_Y - BALL_RADIUS) {
        const ox = ball.position.x - cue.position.x,
          oz = ball.position.z - cue.position.z;
        const along = ox * dx + oz * dz,
          cross = ox * dz - oz * dx;
        if (along > 0 && Math.abs(cross) < BALL_RADIUS * 2)
          distance = Math.min(
            distance,
            along - Math.sqrt((BALL_RADIUS * 2) ** 2 - cross ** 2),
          );
      }
    for (const [v, d, limit] of [
      [cue.position.x, dx, W - BALL_RADIUS],
      [cue.position.z, dz, L - BALL_RADIUS],
    ])
      if (Math.abs(d) > 0.00001)
        distance = Math.min(distance, ((d > 0 ? limit : -limit) - v) / d);
    distance = Math.max(0, distance);
    const start = new THREE.Vector3(
      cue.position.x + group.position.x,
      BALL_Y + 0.01,
      cue.position.z + group.position.z,
    );
    const end = start
      .clone()
      .add(new THREE.Vector3(dx, 0, dz).multiplyScalar(distance));
    this.guide.geometry.setFromPoints([start, end]);
    this.guide.computeLineDistances();
    this.ghost.position.copy(end);
    this.placeCue(tableId, cue.position, angle, this.cuePull);
  }
  setTablePresence(
    tables: TableState[],
    self: string,
    localPlacement: LocalPlacement,
    dt: number,
    now: number,
  ) {
    this.tablePresence.update(tables, self, localPlacement, dt, now);
  }
  resize() {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }
  updateCamera(
    dt: number,
    predicted: { x: number; z: number } | null,
    tableId: string | null,
    entered: boolean,
    cameraLocked = false,
  ) {
    this.focusedTable = tableId;
    const table = TABLES.find((t) => t.id === tableId);
    const mobile = innerWidth < 700;
    if (table) this.target.set(table.x, FELT_Y, table.z);
    else
      this.target.set(
        entered && predicted ? predicted.x : 0,
        0.5,
        entered && predicted ? predicted.z : 0,
      );
    if (!cameraLocked)
      this.cameraRig.update(dt, this.target, table ? "table" : "hall", mobile);
    this.camera.updateMatrixWorld();
  }
  render(dt: number) {
    for (const avatar of this.avatars.values()) {
      const state = avatar.userData.player as PlayerState;
      avatar.visible = true;
      avatar.scale.setScalar(AVATAR_SCALE * (state.connected ? 1 : 0.9));
    }
    for (const wall of this.walls) {
      wall.group.visible = wall.x
        ? this.camera.position.x * Math.sign(wall.x) < Math.abs(wall.x) - 0.2
        : this.camera.position.z * Math.sign(wall.z) < Math.abs(wall.z) - 0.2;
    }
    const nearest = TABLES.reduce((a, b) =>
      Math.hypot(a.x - this.camera.position.x, a.z - this.camera.position.z) <
      Math.hypot(b.x - this.camera.position.x, b.z - this.camera.position.z)
        ? a
        : b,
    );
    const viewedTable =
      TABLES.find((table) => table.id === this.focusedTable) ?? nearest;
    for (const fixture of this.fixtures) {
      fixture.rig.visible = fixture.id !== this.focusedTable;
      const opacity = fixtureOpacity(
        fixture.bounds,
        this.camera.position,
        viewedTable,
      );
      fixture.visibility.value = THREE.MathUtils.damp(
        fixture.visibility.value,
        opacity,
        6,
        dt,
      );
      if (Math.abs(fixture.visibility.value - opacity) < 0.001)
        fixture.visibility.value = opacity;
    }
    this.updateSmoke(dt, this.camera);
    this.collisionDebug?.update(this.avatars, [
      this.cue,
      this.guide,
      this.ghost,
    ]);
    this.renderer.setViewport(0, 0, innerWidth, innerHeight);
    this.renderer.render(this.scene, this.camera);
    if (!this.collisionDebug) {
      this.renderer.autoClear = false;
      this.renderer.render(this.vignette.scene, this.vignette.camera);
      this.renderer.autoClear = true;
    }
  }
}
