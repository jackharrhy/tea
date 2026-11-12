import * as THREE from "three/webgpu";
import type { TableState } from "@harrhy/pool-protocol";
import { BALL_RADIUS, canPlaceCue } from "@harrhy/pool";
import { FELT_Y } from "@harrhy/pool/table";
import { cuePose } from "./cue-pose";

export type LocalPlacement = {
  table: string;
  point: { x: number; z: number };
} | null;

type Presence = {
  cue: THREE.Group;
  ghost: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  ball: THREE.Mesh;
  ballVisible: boolean;
  player: string | null;
  turn: number;
  angle: number;
  power: number;
  aiming: boolean;
  lastAt: number;
  strokeAt: number | null;
  aimBall: { x: number; z: number };
};

export class TablePresence {
  private tables = new Map<string, Presence>();
  private axis = new THREE.Vector3();
  private cueAxis = new THREE.Vector3(1, 0, 0);

  constructor(
    tables: Map<string, THREE.Group>,
    balls: Map<string, THREE.Mesh[]>,
    template: THREE.Group,
    private invalidateShadow: (table: string) => void,
  ) {
    for (const [id, group] of tables) {
      const ball = balls.get(id)![0];
      const cue = template.clone(true);
      cue.name = "remote-cue";
      cue.visible = false;
      const ghost = new THREE.Mesh(
        ball.geometry,
        (ball.material as THREE.MeshStandardMaterial).clone(),
      );
      ghost.name = "placement-ghost";
      ghost.visible = false;
      ghost.castShadow = ghost.receiveShadow = true;
      group.add(cue, ghost);
      this.tables.set(id, {
        cue,
        ghost,
        ball,
        ballVisible: ball.visible,
        player: null,
        turn: -1,
        angle: 0,
        power: 0,
        aiming: false,
        lastAt: 0,
        strokeAt: null,
        aimBall: { x: 0, z: 0 },
      });
    }
  }

  // now shares the server timestamp clock used by CuePresence.at; dt is seconds.
  update(
    tables: TableState[],
    self: string,
    localPlacement: LocalPlacement,
    dt: number,
    now: number,
  ) {
    const blend = 1 - Math.exp(-12 * Math.max(0, dt));
    for (const [id, view] of this.tables) {
      const table = tables.find((candidateTable) => candidateTable.id === id);
      const shooter = table?.match.players[table.match.turn];
      const presence = table?.cue;
      const remote =
        table &&
        presence &&
        presence.player !== self &&
        presence.player === shooter &&
        presence.turn === table.match.shotNumber &&
        now - presence.at < 1200
          ? presence
          : null;
      const placement =
        table?.match.phase === "ball-in-hand"
          ? shooter === self
            ? localPlacement?.table === id
              ? localPlacement.point
              : null
            : remote?.placement
          : null;
      const wasPlacing = view.ghost.visible;
      const ballWasVisible = view.ball.visible;
      const previousX = view.ghost.position.x;
      const previousZ = view.ghost.position.z;
      view.ghost.visible = !!placement;
      if (placement && table) {
        if (!wasPlacing) view.ballVisible = view.ball.visible;
        view.ball.visible = false;
        const snap =
          shooter === self ||
          !wasPlacing ||
          view.player !== shooter ||
          view.turn !== table.match.shotNumber;
        view.ghost.position.x +=
          (placement.x - view.ghost.position.x) * (snap ? 1 : blend);
        view.ghost.position.z +=
          (placement.z - view.ghost.position.z) * (snap ? 1 : blend);
        view.ghost.position.y = FELT_Y + BALL_RADIUS;
        const valid = canPlaceCue(
          table.balls,
          view.ghost.position.x,
          view.ghost.position.z,
        );
        view.ghost.material.color.setHex(valid ? 0xffffff : 0xe34b44);
      } else if (wasPlacing) {
        view.ball.visible = view.ballVisible;
      }
      if (
        wasPlacing !== view.ghost.visible ||
        ballWasVisible !== view.ball.visible ||
        (view.ghost.visible &&
          (previousX !== view.ghost.position.x ||
            previousZ !== view.ghost.position.z))
      )
        this.invalidateShadow(id);

      const wasAiming = view.aiming;
      view.aiming =
        !!remote && table?.match.phase === "aiming" && !remote.placement;
      const sameShooter =
        shooter !== self &&
        view.player === shooter &&
        view.turn === table?.match.shotNumber;
      if (
        table?.match.phase !== "rolling" ||
        !sameShooter ||
        (presence && (!remote || presence.placement))
      ) {
        view.strokeAt = null;
      } else if (wasAiming && now - view.lastAt < 1200) {
        view.strokeAt = now;
      }
      if (view.strokeAt !== null && now - view.strokeAt >= 180)
        view.strokeAt = null;
      view.cue.visible = view.aiming || view.strokeAt !== null;
      if (view.aiming && remote) {
        if (
          !wasAiming ||
          view.player !== shooter ||
          view.turn !== remote.turn
        ) {
          view.angle = remote.angle;
          view.power = remote.power;
        } else {
          const delta = remote.angle - view.angle;
          view.angle += Math.atan2(Math.sin(delta), Math.cos(delta)) * blend;
          view.power += (remote.power - view.power) * blend;
        }
        view.lastAt = remote.at;
        view.aimBall.x = view.ball.position.x;
        view.aimBall.z = view.ball.position.z;
      }
      if (view.cue.visible) {
        const progress =
          view.strokeAt === null
            ? 0
            : THREE.MathUtils.clamp((now - view.strokeAt - 85) / 40, 0, 1);
        const pose = cuePose(
          view.aimBall,
          view.angle,
          view.power * (1 - progress) ** 2,
          progress === 1,
        );
        view.cue.position.fromArray(pose.position);
        view.cue.quaternion.setFromUnitVectors(
          this.cueAxis,
          this.axis.fromArray(pose.axis),
        );
      }
      view.player = shooter ?? null;
      view.turn = table?.match.shotNumber ?? -1;
    }
  }

  dispose() {
    for (const [id, view] of this.tables) {
      if (view.ghost.visible) {
        view.ball.visible = view.ballVisible;
        this.invalidateShadow(id);
      }
      view.cue.removeFromParent();
      view.ghost.removeFromParent();
      view.ghost.material.dispose();
    }
    this.tables.clear();
  }
}
