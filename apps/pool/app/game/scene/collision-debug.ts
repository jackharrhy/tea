import * as THREE from "three/webgpu";
import {
  CUSHIONS,
  RETURNS,
  FELT_GEOMETRY,
  MESH_REST_OFFSET,
  type StaticBox,
} from "@tea/pool/table";
import {
  AVATAR_RADIUS,
  HALL,
  HALL_MARGIN,
  HALL_OBSTACLES,
} from "@tea/pool-simulation/geometry";

const COLORS: Record<StaticBox["kind"], number> = {
  cushion: 0x75df88,
  chute: 0xe8b86b,
  tray: 0x5cd4e0,
  wall: 0xeb7474,
  guard: 0xe5a7a7,
  pocket: 0xc89bfa,
};

function outlined(
  geometry: THREE.BufferGeometry,
  color: number,
  opacity = 0.08,
) {
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  mesh.add(
    new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.8,
        depthTest: false,
        depthWrite: false,
      }),
    ),
  );
  return mesh;
}

export function tableCollisionView() {
  const group = new THREE.Group();
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const edgeGeometry = new THREE.EdgesGeometry(unit);
  const edges = edgeGeometry.getAttribute("position");
  for (const kind of Object.keys(COLORS) as StaticBox["kind"][]) {
    const parts = [...CUSHIONS, ...RETURNS].filter(
      (part) => part.kind === kind,
    );
    if (!parts.length) continue;
    const mesh = new THREE.InstancedMesh(
      unit,
      new THREE.MeshBasicMaterial({
        color: COLORS[kind],
        transparent: true,
        opacity: 0.07,
        depthWrite: false,
      }),
      parts.length,
    );
    mesh.name = `collider:${kind}`;
    mesh.userData.colliders = parts;
    const vertices: number[] = [];
    const matrix = new THREE.Matrix4();
    const vertex = new THREE.Vector3();
    for (const [index, part] of parts.entries()) {
      matrix.compose(
        new THREE.Vector3(...part.center),
        new THREE.Quaternion(...part.rotation),
        new THREE.Vector3(...part.size),
      );
      mesh.setMatrixAt(index, matrix);
      for (let i = 0; i < edges.count; i++) {
        vertex.fromBufferAttribute(edges, i).applyMatrix4(matrix);
        vertices.push(vertex.x, vertex.y, vertex.z);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    const wire = new THREE.BufferGeometry();
    wire.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(vertices, 3),
    );
    mesh.add(
      new THREE.LineSegments(
        wire,
        new THREE.LineBasicMaterial({
          color: COLORS[kind],
          transparent: true,
          opacity: 0.8,
          depthTest: false,
          depthWrite: false,
        }),
      ),
    );
    group.add(mesh);
  }
  edgeGeometry.dispose();
  const felt = new THREE.BufferGeometry();
  felt.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(FELT_GEOMETRY.positions, 3),
  );
  felt.setIndex(FELT_GEOMETRY.indices);
  const mesh = new THREE.Mesh(
    felt,
    new THREE.MeshBasicMaterial({
      color: 0x5694db,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  mesh.name = "collider:felt";
  mesh.position.y = -MESH_REST_OFFSET;
  mesh.add(
    new THREE.LineSegments(
      new THREE.WireframeGeometry(felt),
      new THREE.LineBasicMaterial({
        color: 0x7192b4,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
      }),
    ),
  );
  group.add(mesh);
  return group;
}

export class CollisionDebug {
  readonly group = new THREE.Group();
  private graphics: THREE.Group[];
  private wireBalls: {
    source: THREE.Mesh;
    wire: THREE.Mesh;
    material: THREE.Material | THREE.Material[];
  }[] = [];
  private mechanism = new THREE.Group();
  private collisionGeometry: THREE.Object3D[] = [];
  private inspect: HTMLInputElement;
  private players = new Map<string, THREE.Mesh>();
  private circle = new THREE.RingGeometry(
    AVATAR_RADIUS - 0.003,
    AVATAR_RADIUS + 0.003,
    40,
  );
  private circleMaterial = new THREE.MeshBasicMaterial({
    color: 0xf3ead6,
    side: THREE.DoubleSide,
    depthTest: false,
  });
  private overlay: HTMLInputElement;
  private panel: HTMLElement;

  constructor(
    scene: THREE.Scene,
    tables: Map<string, THREE.Group>,
    balls: Map<string, THREE.Mesh[]>,
    hall: THREE.Group,
  ) {
    this.group.name = "collision-debug";
    this.mechanism.name = "return-inspection";
    this.mechanism.visible = false;
    const workLight = new THREE.DirectionalLight(0xdce6f5, 4);
    workLight.position.set(-3, 6, 4);
    this.mechanism.add(workLight, new THREE.AmbientLight(0xffffff, 1));
    scene.add(this.mechanism);
    this.graphics = [hall];
    hall.visible = false;
    for (const [id, table] of tables) {
      const actualBalls = balls.get(id)!;
      const art = new THREE.Group();
      art.name = "table-graphics";
      art.visible = false;
      // Moving children mutates the array during iteration.
      // oxlint-disable-next-line unicorn/no-useless-spread
      for (const child of [...table.children]) art.add(child);
      table.add(art);
      this.graphics.push(art);
      const internals = new THREE.Group();
      internals.position.copy(table.position);
      const returns = table.getObjectByName("return-system");
      if (returns) internals.add(returns.clone());
      table.traverse((child) => {
        if (child.name === "pocket") internals.add(child.clone());
      });
      this.mechanism.add(internals);
      const collision = tableCollisionView();
      this.collisionGeometry.push(...collision.children);
      collision.name = `collision-table:${id}`;
      collision.position.copy(table.position);
      for (const source of actualBalls) {
        const wire = new THREE.Mesh(
          source.geometry,
          new THREE.MeshBasicMaterial({
            color: source === actualBalls[0] ? 0xffffff : 0xffd77b,
            wireframe: true,
            depthTest: false,
            depthWrite: false,
          }),
        );
        wire.name = "collider:ball";
        collision.add(wire);
        this.wireBalls.push({ source, wire, material: wire.material });
      }
      this.group.add(collision);
    }
    for (const r of HALL_OBSTACLES) {
      const region = outlined(
        new THREE.PlaneGeometry(r.maxX - r.minX, r.maxZ - r.minZ),
        0xd36e6e,
        0.07,
      );
      region.name = "navigation-exclusion";
      region.rotation.x = -Math.PI / 2;
      region.position.set((r.minX + r.maxX) / 2, 0.008, (r.minZ + r.maxZ) / 2);
      this.group.add(region);
      this.collisionGeometry.push(region);
    }
    const boundary = outlined(
      new THREE.PlaneGeometry(
        2 * (HALL.x - HALL_MARGIN),
        2 * (HALL.z - HALL_MARGIN),
      ),
      0x516c88,
      0.025,
    );
    boundary.rotation.x = -Math.PI / 2;
    boundary.position.y = -0.005;
    this.group.add(boundary);
    this.collisionGeometry.push(boundary);
    scene.add(this.group);
    const panel = document.createElement("aside");
    this.panel = panel;
    panel.id = "collision-debug";
    Object.assign(panel.style, {
      position: "fixed",
      right: "12px",
      top: "12px",
      padding: "10px 12px",
      background: "#0b131ee8",
      color: "#e5edf7",
      font: "12px/1.65 system-ui",
      border: "1px solid #435367",
      zIndex: "10",
    });
    panel.innerHTML = `<strong>Table inspection</strong><br><span style="color:#75df88">Cushions</span> · <span style="color:#c89bfa">Pockets</span><br><span style="color:#e8b86b">Channels</span> · <span style="color:#5cd4e0">Tray</span><br><span style="color:#eb7474">Walls / guards</span><br>Red floor areas block avatar centres.<br>Wire balls are physical; previews are not.<br>Felt contact margin: ${MESH_REST_OFFSET * 1000} mm.<br><label><input type="checkbox"> Overlay graphics</label><br><label><input type="checkbox"> Inspect returns</label>`;
    [this.overlay, this.inspect] = [...panel.querySelectorAll("input")];
    document.body.append(panel);
  }

  update(avatars: Map<string, THREE.Group>, aiming: THREE.Object3D[]) {
    const inspect = this.inspect.checked;
    const show = this.overlay.checked && !inspect;
    this.mechanism.visible = inspect;
    for (const shape of this.collisionGeometry) shape.visible = !inspect;
    for (const art of this.graphics) art.visible = show;
    for (const { source, wire, material } of this.wireBalls) {
      wire.material = inspect ? source.material : material;
      wire.position.copy(source.position);
      wire.quaternion.copy(source.quaternion);
    }
    for (const item of aiming) item.visible = show && item.visible;
    for (const [id, avatar] of avatars) {
      avatar.visible = show;
      let circle = this.players.get(id);
      if (!circle) {
        circle = new THREE.Mesh(this.circle, this.circleMaterial);
        circle.rotation.x = -Math.PI / 2;
        circle.name = "navigation-avatar-radius";
        this.players.set(id, circle);
        this.group.add(circle);
      }
      circle.visible = !inspect;
      circle.position.set(avatar.position.x, 0.015, avatar.position.z);
    }
    for (const [id, circle] of this.players)
      if (!avatars.has(id)) {
        circle.removeFromParent();
        this.players.delete(id);
      }
  }
  dispose() {
    this.panel.remove();
    this.circle.dispose();
    this.circleMaterial.dispose();
  }
}
