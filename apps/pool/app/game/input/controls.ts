import {
  BALL_RADIUS,
  TABLE_HALF_WIDTH as W,
  TABLE_HALF_LENGTH as L,
} from "@tea/pool";
import { RAIL_WIDTH } from "@tea/pool/table";
import {
  STOOLS,
  TABLES,
  findPath,
  tableApproach,
  type Point,
} from "@tea/pool-simulation";
import type {
  PlayerState,
  TableState,
  ClientMessage,
} from "@tea/pool-protocol";
import type { HallView } from "../scene/world";
import type { GameUI } from "../ui";
import type { Shot } from "../prediction/shot-command";
import { CueDrag } from "./cue-drag";
import { walkDirection } from "./walking";
interface InputState {
  id: string;
  own: PlayerState | undefined;
  table: TableState | undefined;
  entered: boolean;
  connected: boolean;
  focusTable: string | null;
  shotBlocked: boolean;
}
interface InputActions {
  read(): InputState;
  position(): Point;
  focus(table: string | null): void;
  changed(): void;
  joinNearby(): void;
  approach?(table: string): Point;
  arrive(table: string): void;
  shoot(shot: Shot): void;
  send(message: ClientMessage): boolean;
}
export class Controls {
  angle = Math.PI / 2;
  power = 0;
  placement: Point | null = null;
  target: Point | null = null;
  route: Point[] = [];
  arrivalTable: string | null = null;
  arrivalSeat: string | null = null;
  movePointer: { id: number; x: number; y: number } | null = null;
  shotDrag: { id: number; gesture: CueDrag } | null = null;
  keyCharge: { table: string; turn: number; angle: number; at: number } | null =
    null;
  cameraDrag: {
    id: number;
    button: number;
    x: number;
    y: number;
    pan: boolean;
  } | null = null;
  private touchPointers = new Set<number>();
  private touchInterrupted = false;
  private readonly abort = new AbortController();
  readonly keys = new Set<string>();
  readonly stickInput = { x: 0, z: 0 };
  private stick: HTMLElement;
  private knob: HTMLElement;
  constructor(
    private canvas: HTMLCanvasElement,
    private view: HallView,
    private ui: Pick<GameUI, "root" | "closeMenu" | "closeChat" | "openChat">,
    private actions: InputActions,
  ) {
    this.stick = ui.root.querySelector("#stick")!;
    this.knob = this.stick.querySelector("i")!;
  }
  private me() {
    return this.actions.read().own;
  }
  private currentTable() {
    return this.actions.read().table;
  }
  private myTurn(table: TableState) {
    return (
      this.actions.read().connected &&
      table.match.players[table.match.turn] === this.actions.read().id
    );
  }
  private typing() {
    return (
      document.activeElement instanceof HTMLInputElement &&
      document.activeElement.type !== "range"
    );
  }
  bind() {
    window.addEventListener(
      "pointerdown",
      (event) => {
        if (event.pointerType !== "touch") return;
        this.touchPointers.add(event.pointerId);
        if (this.touchPointers.size > 1) {
          this.touchInterrupted = true;
          this.cancelShot();
          this.stopWalkingPointer();
          this.clearDestination();
        }
      },
      { capture: true, signal: this.abort.signal },
    );
    for (const type of ["pointerup", "pointercancel"])
      window.addEventListener(
        type,
        (event) => {
          const pointer = event as PointerEvent;
          this.touchPointers.delete(pointer.pointerId);
          if (!this.touchPointers.size) this.touchInterrupted = false;
        },
        { capture: true, signal: this.abort.signal },
      );
    this.canvas.addEventListener(
      "contextmenu",
      (event) => event.preventDefault(),
      {
        signal: this.abort.signal,
      },
    );
    this.canvas.addEventListener(
      "pointermove",
      (event) => {
        if (this.shotDrag) {
          if (event.pointerId !== this.shotDrag.id) return;
          if (event.buttons & 6) this.cancelShot();
          else
            this.power = this.shotDrag.gesture.update({
              x: event.clientX,
              y: event.clientY,
            });
          return;
        }
        if (!this.cameraDrag) {
          if (this.movePointer && event.pointerId === this.movePointer.id) {
            if (!(event.buttons & 1)) this.stopWalkingPointer();
            else {
              this.movePointer.x = event.clientX;
              this.movePointer.y = event.clientY;
            }
          }
          if (!(event.buttons & 6)) this.aimAt(event);
          return;
        }
        if (event.pointerId !== this.cameraDrag.id) return;
        if (!(event.buttons & (this.cameraDrag.button === 2 ? 2 : 4))) {
          this.stopCameraDrag();
          return;
        }
        const dx = event.clientX - this.cameraDrag.x,
          dy = event.clientY - this.cameraDrag.y;
        if (this.cameraDrag.pan) this.view.panBy(dx, dy);
        else this.view.orbitBy(dx, dy);
        this.cameraDrag.x = event.clientX;
        this.cameraDrag.y = event.clientY;
      },
      { signal: this.abort.signal },
    );
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
      this.canvas.addEventListener(
        type,
        (event) => {
          const pointer = event as PointerEvent;
          if (this.shotDrag?.id === pointer.pointerId) {
            if (type === "pointerup" && pointer.button !== 0) return;
            const shot =
              type === "pointerup"
                ? this.shotDrag.gesture.release({
                    x: pointer.clientX,
                    y: pointer.clientY,
                  })
                : null;
            this.cancelShot();
            if (shot) this.actions.shoot(shot);
            return;
          }
          if (
            this.movePointer?.id === pointer.pointerId &&
            (type !== "pointerup" || pointer.button === 0)
          ) {
            this.stopWalkingPointer();
            if (type !== "pointerup") this.clearDestination();
          }
          if (
            this.cameraDrag &&
            pointer.pointerId === this.cameraDrag.id &&
            (type !== "pointerup" || pointer.button === this.cameraDrag.button)
          )
            this.stopCameraDrag();
        },
        { signal: this.abort.signal },
      );
    this.canvas.addEventListener(
      "wheel",
      (event) => {
        if (!this.view.containsPoint(event.clientX, event.clientY)) return;
        event.preventDefault();
        this.cancelShot();
        this.view.zoomBy(
          event.deltaY *
            (event.deltaMode === 1
              ? 16
              : event.deltaMode === 2
                ? innerHeight
                : 1),
        );
      },
      { passive: false, signal: this.abort.signal },
    );
    this.canvas.addEventListener(
      "pointerdown",
      (event) => {
        if (this.typing()) return;
        if (
          this.cameraDrag ||
          (event.pointerType === "touch" && this.touchInterrupted)
        )
          return;
        if (this.keyCharge) this.cancelShot();
        if (event.button === 2 || event.button === 1) {
          if (!this.view.containsPoint(event.clientX, event.clientY)) return;
          event.preventDefault();
          this.cancelShot();
          this.stopWalkingPointer();
          this.canvas.focus();
          this.cameraDrag = {
            id: event.pointerId,
            button: event.button,
            x: event.clientX,
            y: event.clientY,
            pan: event.button === 1 || event.shiftKey,
          };
          this.canvas.setPointerCapture(event.pointerId);
          this.canvas.style.cursor = "grabbing";
          this.clearDestination();
          return;
        }
        if (
          !this.actions.read().entered ||
          !this.actions.read().connected ||
          event.button !== 0 ||
          this.movePointer ||
          this.shotDrag ||
          this.keyCharge
        )
          return;
        this.canvas.focus();
        const table = this.currentTable();
        if (table) {
          if (this.myTurn(table) && table.match.phase === "ball-in-hand") {
            const point = this.view.hit(event.clientX, event.clientY, true),
              spot = TABLES.find((t) => t.id === table.id)!;
            if (point)
              this.actions.send({
                type: "place",
                table: table.id,
                turn: table.match.shotNumber,
                x: point.x - spot.x,
                z: point.z - spot.z,
              });
          } else if (
            this.myTurn(table) &&
            table.match.phase === "aiming" &&
            !this.actions.read().shotBlocked
          ) {
            this.aimAt(event);
            const direction = this.view.shotDirection(table.id, this.angle);
            if (
              !direction ||
              !this.view.containsPoint(event.clientX, event.clientY)
            )
              return;
            this.shotDrag = {
              id: event.pointerId,
              gesture: new CueDrag(
                { x: event.clientX, y: event.clientY },
                direction,
                {
                  table: table.id,
                  turn: table.match.shotNumber,
                  angle: this.angle,
                },
                Math.min(innerWidth, innerHeight) * 0.3,
              ),
            };
            this.power = 0;
            event.preventDefault();
            this.canvas.setPointerCapture(event.pointerId);
          }
          return;
        }
        if (this.me()?.table) {
          const point = this.view.hit(event.clientX, event.clientY, true);
          const spot =
            point &&
            TABLES.find(
              (t) =>
                Math.abs(point.x - t.x) < W + RAIL_WIDTH &&
                Math.abs(point.z - t.z) < L + RAIL_WIDTH,
            );
          if (spot) {
            this.actions.focus(spot.id);
            this.actions.changed();
          }
          return;
        }
        if (!this.view.containsPoint(event.clientX, event.clientY)) return;
        event.preventDefault();
        this.movePointer = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
        };
        this.canvas.setPointerCapture(event.pointerId);
        this.walkAt(event.clientX, event.clientY);
      },
      { signal: this.abort.signal },
    );
    window.addEventListener(
      "keydown",
      (event) => {
        if (this.typing()) return;
        const key = event.key.toLowerCase();
        if (key === "t" && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          this.cancelShot();
          this.ui.openChat();
          this.keys.clear();
          return;
        }
        if (!this.actions.read().entered) return;
        if (key === "escape") {
          if (this.me()?.seat) this.actions.send({ type: "stand" });
          const drawing = !!this.shotDrag || !!this.keyCharge;
          this.cancelShot();
          if (drawing) return;
          if (this.ui.closeMenu()) {
            this.canvas.focus();
            return;
          }

          this.stopWalkingPointer();
          this.clearDestination();
          this.actions.focus(null);
          this.ui.closeChat();
          this.actions.changed();
          this.canvas.focus();
          return;
        }
        if (key === "f") {
          this.cancelShot();
          this.view.recenter();
          return;
        }
        const active = document.activeElement;
        if (
          active instanceof HTMLButtonElement ||
          (active instanceof HTMLElement && active.closest("summary"))
        )
          return;
        if (
          [
            "w",
            "a",
            "s",
            "d",
            "arrowup",
            "arrowdown",
            "arrowleft",
            "arrowright",
            " ",
          ].includes(key)
        )
          event.preventDefault();
        if (key === "e" && !event.repeat) {
          if (this.me()?.table) {
            this.actions.focus(this.me()!.table);
            this.actions.changed();
          } else this.actions.joinNearby();
        }
        if (
          key === " " &&
          !event.repeat &&
          !this.shotDrag &&
          !this.cameraDrag
        ) {
          const table = this.currentTable();
          if (
            table &&
            this.myTurn(table) &&
            table.match.phase === "aiming" &&
            !this.actions.read().shotBlocked
          )
            this.keyCharge = {
              table: table.id,
              turn: table.match.shotNumber,
              angle: this.angle,
              at: performance.now(),
            };
        }
        if (
          this.actions.read().focusTable &&
          ["arrowleft", "arrowright"].includes(key) &&
          !this.shotDrag &&
          !this.keyCharge
        )
          this.angle += key === "arrowleft" ? -0.025 : 0.025;
        if (key === "enter") {
          event.preventDefault();
          this.cancelShot();
          this.ui.openChat();
          this.keys.clear();
          return;
        }
        this.keys.add(key);
        if (
          [
            "w",
            "a",
            "s",
            "d",
            "arrowup",
            "arrowdown",
            "arrowleft",
            "arrowright",
          ].includes(key)
        ) {
          this.stopWalkingPointer();
          this.clearDestination();
        }
      },
      { signal: this.abort.signal },
    );
    window.addEventListener(
      "keyup",
      (event) => {
        this.keys.delete(event.key.toLowerCase());
        if (event.key === " " && this.keyCharge) {
          const charge = this.keyCharge;
          const strength = Math.min(1, (performance.now() - charge.at) / 1200);
          this.cancelShot();
          if (strength >= 0.05)
            this.actions.shoot({
              table: charge.table,
              turn: charge.turn,
              angle: charge.angle,
              power: strength,
            });
        }
      },
      { signal: this.abort.signal },
    );
    window.addEventListener(
      "blur",
      () => {
        this.touchPointers.clear();
        this.touchInterrupted = false;
        this.cancelShot();
        this.stopCameraDrag();
        this.stopWalkingPointer();
        this.keys.clear();
        this.clearDestination();
        this.stickInput.x = this.stickInput.z = 0;
      },
      { signal: this.abort.signal },
    );

    this.stick.addEventListener(
      "pointerdown",
      (event) => {
        this.stick.setPointerCapture(event.pointerId);
        this.moveStick(event);
      },
      { signal: this.abort.signal },
    );
    this.stick.addEventListener(
      "pointermove",
      (event) => {
        if (this.stick.hasPointerCapture(event.pointerId))
          this.moveStick(event);
      },
      { signal: this.abort.signal },
    );
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
      this.stick.addEventListener(
        type,
        () => {
          this.stickInput.x = this.stickInput.z = 0;
          this.knob.style.transform = "";
        },
        { signal: this.abort.signal },
      );
  }
  dispose() {
    this.abort.abort();
    this.cancelShot();
    this.stopCameraDrag();
    this.stopWalkingPointer();
    this.keys.clear();
    this.clearDestination();
    this.stickInput.x = this.stickInput.z = 0;
    this.knob.style.transform = "";
  }
  clearDestination() {
    this.target = null;
    this.route = [];
    this.arrivalTable = null;
    this.arrivalSeat = null;
    this.view.cursor.visible = false;
  }
  stopWalkingPointer() {
    const pointer = this.movePointer;
    this.movePointer = null;
    if (pointer && this.canvas.hasPointerCapture(pointer.id))
      this.canvas.releasePointerCapture(pointer.id);
  }
  walkTo(point: Point, table: string | null, seat: string | null = null) {
    const path = findPath(this.actions.position(), point);
    this.target = path[path.length - 1];
    this.route = path.slice(1);
    this.arrivalTable = table;
    this.arrivalSeat = seat;
    this.view.cursor.position.set(this.target.x, 0.02, this.target.z);
    this.view.cursor.visible = true;
  }
  walkAt(clientX: number, clientY: number) {
    if (
      this.actions.read().focusTable ||
      this.me()?.table ||
      !this.actions.read().connected
    )
      return;
    const seatId = this.view.hitSeat(clientX, clientY);
    const seat = STOOLS.find((candidateSeat) => candidateSeat.id === seatId);
    if (seat) {
      if (this.me()?.seat !== seat.id && this.arrivalSeat !== seat.id)
        this.walkTo(seat, null, seat.id);
      return;
    }
    const tablePoint = this.view.hit(clientX, clientY, true);
    const spot =
      tablePoint &&
      TABLES.find(
        (t) =>
          Math.abs(tablePoint.x - t.x) < W + RAIL_WIDTH &&
          Math.abs(tablePoint.z - t.z) < L + RAIL_WIDTH,
      );
    const ground = this.view.hit(clientX, clientY);
    if (!ground) return;
    const point = spot
      ? (this.actions.approach?.(spot.id) ??
        tableApproach(spot.id, this.actions.position()))
      : ground;
    if (
      this.target &&
      !this.arrivalSeat &&
      this.arrivalTable === (spot?.id ?? null) &&
      Math.hypot(point.x - this.target.x, point.z - this.target.z) < 0.01
    )
      return;
    this.walkTo(point, spot?.id ?? null);
  }

  cancelShot() {
    const drag = this.shotDrag;
    this.shotDrag = null;
    this.keyCharge = null;
    this.power = 0;
    if (drag && this.canvas.hasPointerCapture(drag.id))
      this.canvas.releasePointerCapture(drag.id);
  }

  aimAt(event: PointerEvent) {
    if (this.typing() || this.shotDrag || this.keyCharge) return;
    const table = this.currentTable();
    if (!table || !this.myTurn(table)) return;
    const point = this.view.hit(event.clientX, event.clientY, true),
      spot = TABLES.find((t) => t.id === table.id)!;
    if (table.match.phase === "ball-in-hand") {
      const x = point && point.x - spot.x,
        z = point && point.z - spot.z;
      this.placement =
        x !== null &&
        z !== null &&
        Math.abs(x) <= W - BALL_RADIUS &&
        Math.abs(z) <= L - BALL_RADIUS
          ? { x, z }
          : null;
      return;
    }
    if (table.match.phase !== "aiming") return;
    const cue = table.balls.find((b) => b.id === 0);
    if (
      point &&
      cue &&
      Math.hypot(point.x - spot.x - cue.x, point.z - spot.z - cue.z) > 0.12
    )
      this.angle = Math.atan2(
        point.z - spot.z - cue.z,
        point.x - spot.x - cue.x,
      );
  }

  stopCameraDrag() {
    const drag = this.cameraDrag;
    this.cameraDrag = null;
    this.canvas.style.cursor = "";
    if (drag && this.canvas.hasPointerCapture(drag.id))
      this.canvas.releasePointerCapture(drag.id);
  }

  moveStick(event: PointerEvent) {
    this.stopWalkingPointer();
    const r = this.stick.getBoundingClientRect(),
      dx = (event.clientX - r.left - r.width / 2) / 40,
      dy = (event.clientY - r.top - r.height / 2) / 40;
    const n = Math.max(1, Math.hypot(dx, dy));
    this.stickInput.x = dx / n;
    this.stickInput.z = dy / n;
    this.knob.style.transform = `translate(${this.stickInput.x * 30}px,${this.stickInput.z * 30}px)`;
    this.clearDestination();
  }

  direction(): Point {
    let x = 0,
      z = 0;
    if (
      !this.me()?.table &&
      !this.actions.read().focusTable &&
      !this.typing()
    ) {
      if (this.target) {
        const here = this.actions.position();
        while (
          this.route.length &&
          Math.hypot(this.route[0].x - here.x, this.route[0].z - here.z) < 0.02
        )
          this.route.shift();
        const next = this.route[0];
        if (next) {
          ({ x, z } = walkDirection(
            here,
            next,
            this.route.length === 1 ? "final" : "intermediate",
          ));
        } else if (
          !this.movePointer &&
          Math.hypot(
            this.me()!.x - this.target.x,
            this.me()!.z - this.target.z,
          ) < 0.2
        ) {
          const table = this.arrivalTable;
          const seat = this.arrivalSeat;
          this.clearDestination();
          if (table) this.actions.arrive(table);
          if (seat) this.actions.send({ type: "sit", seat });
        }
      } else {
        const horizontal =
          Number(this.keys.has("d") || this.keys.has("arrowright")) -
          Number(this.keys.has("a") || this.keys.has("arrowleft")) +
          this.stickInput.x;
        const vertical =
          Number(this.keys.has("s") || this.keys.has("arrowdown")) -
          Number(this.keys.has("w") || this.keys.has("arrowup")) +
          this.stickInput.z;
        ({ x, z } = this.view.movement(horizontal, vertical));
      }
    }

    return { x, z };
  }
  reconcile(before: Point, corrected: Point, seated: boolean) {
    if (
      this.target &&
      !seated &&
      Math.hypot(corrected.x - before.x, corrected.z - before.z) > 0.1
    )
      this.route = findPath(corrected, this.target).slice(1);
  }
  validateCharge() {
    const current = this.currentTable();
    if (
      !current ||
      !this.myTurn(current) ||
      current.match.phase !== "ball-in-hand"
    )
      this.placement = null;
    const charge = this.shotDrag?.gesture.shot ?? this.keyCharge;
    if (!charge) return;
    const table = this.currentTable();
    if (
      !table ||
      table.id !== charge.table ||
      table.match.shotNumber !== charge.turn ||
      table.match.phase !== "aiming" ||
      !this.myTurn(table)
    )
      this.cancelShot();
  }
  disconnected() {
    this.placement = null;
    this.cancelShot();
    this.stopWalkingPointer();
    this.keys.clear();
    this.stickInput.x = this.stickInput.z = 0;
    this.clearDestination();
  }
}
