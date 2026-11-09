import { TABLES, type Point } from "@tea/pool-simulation";
import type {
  ClientMessage,
  Snapshot,
  TableState,
  ServerMessage,
} from "@tea/pool-protocol";
import { GameAudio } from "./audio";
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
interface UIActions {
  enter(): void;
  action(
    action: "join" | "take-seat" | "watch" | "back" | "leave" | "rematch",
  ): void;
  send(message: ClientMessage): boolean;
  cancelShot(): void;
  clearKeys(): void;
}
export class GameUI {
  readonly canvas = $<HTMLCanvasElement>("world");
  private nameInput = $<HTMLInputElement>("name");
  private colorInput = $<HTMLInputElement>("player-color");
  private chatOpen = false;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly abort = new AbortController();
  nearby: string | null = null;
  constructor(private audio: GameAudio) {
    const savedColor = localStorage.getItem("8ball.color");
    if (savedColor && /^#[0-9a-f]{6}$/i.test(savedColor))
      this.colorInput.value = savedColor;
    if (!this.nameInput.value)
      this.nameInput.value = localStorage.getItem("8ball.name") ?? "";
  }
  identity() {
    return {
      name: this.nameInput.value.trim() || "Guest",
      color: Number.parseInt(this.colorInput.value.slice(1), 16),
    };
  }
  ready() {
    this.status("Enter the hall");
    $("entry").querySelector<HTMLButtonElement>("button")!.disabled = false;
  }
  failed() {
    $("connection").classList.remove("sr-only");
    this.status(
      "The 3D renderer could not start. Try another browser or enable hardware acceleration.",
    );
  }
  status(text: string) {
    $("connection").textContent = text;
  }
  welcome() {
    $("entry").hidden = true;
    $("menu").hidden = $("chat-toggle").hidden = $("invite").hidden = false;
    this.canvas.focus();
  }
  toast(text: string) {
    $("toast").textContent = text;
    $("toast").hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => ($("toast").hidden = true), 4500);
  }

  chat(message: Extract<ServerMessage, { type: "chat" }>) {
    const item = document.createElement("li"),
      name = document.createElement("b");
    name.textContent = `${message.name} `;
    item.append(name, document.createTextNode(message.text));
    $("messages").append(item);
    while ($("messages").children.length > 40)
      $("messages").firstChild?.remove();
    $("messages").scrollTop = $("messages").scrollHeight;
  }
  closeMenu() {
    const menu = $<HTMLDetailsElement>("menu");
    const wasOpen = menu.open;
    menu.open = false;
    return wasOpen;
  }
  closeChat() {
    this.chatOpen = false;
    $("chat-form").hidden = true;
    $("chat-toggle").setAttribute("aria-expanded", "false");
  }
  openChat() {
    this.chatOpen = true;
    $("chat-form").hidden = false;
    $("chat-toggle").setAttribute("aria-expanded", "true");
    $<HTMLInputElement>("chat-input").focus();
  }
  private updateSoundLabel() {
    $("sound").textContent = this.audio.enabled ? "Sound on" : "Sound off";
    $("sound").setAttribute(
      "aria-label",
      this.audio.enabled ? "Turn sound off" : "Turn sound on",
    );
  }

  bind(actions: UIActions) {
    const listen = <K extends keyof HTMLElementEventMap>(
      element: HTMLElement,
      type: K,
      handler: (event: HTMLElementEventMap[K]) => void,
    ) =>
      element.addEventListener(type, handler as EventListener, {
        signal: this.abort.signal,
      });
    listen($("entry"), "submit", (event) => {
      event.preventDefault();
      if (!this.nameInput.value.trim()) return;
      localStorage.setItem("8ball.name", this.nameInput.value.trim());
      localStorage.setItem("8ball.color", this.colorInput.value);
      $("entry").querySelector<HTMLButtonElement>("button")!.disabled = true;
      if (localStorage.getItem("8ball.sound") !== "off" && !this.audio.enabled)
        this.audio.toggle();
      this.updateSoundLabel();
      actions.enter();
    });
    for (const action of [
      "join",
      "take-seat",
      "watch",
      "back",
      "leave",
      "rematch",
    ] as const)
      listen($(action), "click", () => actions.action(action));
    listen($("chat-toggle"), "click", () => {
      if (this.chatOpen) {
        this.closeChat();
        this.canvas.focus();
      } else this.openChat();
    });
    listen($("chat-input"), "focus", () => {
      actions.clearKeys();
      actions.cancelShot();
    });
    listen($("chat-form"), "submit", (event) => {
      event.preventDefault();
      const input = $<HTMLInputElement>("chat-input");
      if (input.value.trim()) {
        actions.send({ type: "chat", text: input.value.trim() });
        input.value = "";
      }
      this.closeChat();
      this.canvas.focus();
    });
    listen($("chat-input"), "keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.closeChat();
        this.canvas.focus();
      }
    });
    listen($("invite"), "click", async () => {
      try {
        await navigator.clipboard.writeText(location.origin);
        this.toast("Link copied. Send it to a friend.");
      } catch {
        this.toast(`Invite a friend: ${location.origin}`);
      }
    });
    listen($("sound"), "click", () => {
      const soundEnabled = this.audio.toggle();
      localStorage.setItem("8ball.sound", soundEnabled ? "on" : "off");
      this.updateSoundLabel();
      if (soundEnabled) this.audio.preview();
    });
    listen($("menu"), "toggle", () => {
      if ($<HTMLDetailsElement>("menu").open) actions.cancelShot();
    });
    for (const action of [
      "back",
      "leave",
      "join",
      "take-seat",
      "rematch",
      "watch",
      "chat-toggle",
    ])
      listen($(action), "click", () => {
        actions.cancelShot();
        $<HTMLDetailsElement>("menu").open = false;
        if (action !== "chat-toggle") this.canvas.focus();
      });
  }
  dispose() {
    this.abort.abort();
    clearTimeout(this.toastTimer);
  }
  render(
    state: Snapshot | null,
    id: string,
    entered: boolean,
    connected: boolean,
    focusTable: string | null,
    position: Point,
  ) {
    const me = () => state?.players.find((p) => p.id === id);
    const currentTable = () => state?.tables.find((t) => t.id === focusTable);
    const myTurn = (table: TableState) =>
      connected && table.match.players[table.match.turn] === id;
    const own = me();
    if (connected && state)
      $("connection").textContent =
        `${state.players.filter((p) => p.connected && !p.bot).length} in hall · ${state.players.filter((p) => p.bot).length} bot`;
    $("touch").hidden =
      !entered ||
      !!focusTable ||
      !!own?.table ||
      !matchMedia("(pointer:coarse)").matches;
    const table = currentTable();
    $("table-ui").hidden = !entered || !table;
    if (table) {
      const match = table.match;
      const score = $("score");
      score.replaceChildren();
      match.players.forEach((player, seat) => {
        const div = document.createElement("div");
        const person = state?.players.find((p) => p.id === player);
        const name = document.createElement("span");
        name.textContent = person
          ? `${person.name}${person.connected ? "" : " (away)"}`
          : "Open place";
        const small = document.createElement("small");
        const group = match.groups[seat];
        const remaining = table.balls.filter(
          (ball) =>
            !ball.pocketed &&
            (group === "solid"
              ? ball.id >= 1 && ball.id <= 7
              : group === "stripe"
                ? ball.id >= 9
                : false),
        ).length;
        small.textContent = group
          ? `${group === "solid" ? "Solids" : "Stripes"} · ${remaining} left`
          : "Open table";
        div.append(name, small);
        score.append(div);
      });
      const active = state?.players.find(
        (p) => p.id === match.players[match.turn],
      );
      const winner = state?.players.find((p) => p.id === match.winner);
      $("turn").textContent =
        match.phase === "waiting"
          ? `Table ${table.id}`
          : match.phase === "finished"
            ? `${winner?.name ?? "Opponent"} wins`
            : match.phase === "rolling"
              ? "Balls rolling"
              : myTurn(table)
                ? "Your turn"
                : `${active?.name ?? "Opponent"}’s turn`;
      const bot = state?.players.find(
        (p) => p.bot && match.players.includes(p.id),
      );
      $("message").textContent =
        match.phase === "waiting"
          ? bot
            ? `${bot.name} is ready for a game.`
            : "A place is open. Bring a friend."
          : match.message === "Opening break." && match.phase === "aiming"
            ? myTurn(table)
              ? "You break. Aim, hold and pull back, then release."
              : `${active?.name ?? "Opponent"} to break.`
            : match.phase === "ball-in-hand" && myTurn(table)
              ? "Click clear felt to place the cue ball."
              : match.message;
      $("leave").hidden = own?.table !== table.id;
      $("take-seat").hidden = !!own?.table || match.players.every(Boolean);
      $("rematch").hidden =
        own?.table !== table.id || match.phase !== "finished";
      const ready = table.rematchReady.includes(id);
      $<HTMLButtonElement>("rematch").disabled =
        !connected ||
        ready ||
        !match.players.every(
          (player) => state?.players.find((p) => p.id === player)?.connected,
        );
      $("rematch").textContent = ready ? "Waiting for opponent" : "Play again";
      $("back").textContent =
        own?.table === table.id ? "View hall" : "Back to hall";
    }
    this.updateNearby(state, id, entered, focusTable, position);
    $("back").hidden = !focusTable;
    $("leave").hidden = !own?.table;
  }

  updateNearby(
    state: Snapshot | null,
    id: string,
    entered: boolean,
    focusTable: string | null,
    position: Point,
  ) {
    const me = () => state?.players.find((p) => p.id === id);
    const own = me();
    this.nearby = null;
    if (!entered || !own || focusTable || own.table) {
      $("nearby").hidden = true;
      return;
    }
    const { x, z } = position;
    let distance = 4.6;
    for (const spot of TABLES) {
      const d = Math.hypot(spot.x - x, spot.z - z);
      if (d < distance) {
        this.nearby = spot.id;
        distance = d;
      }
    }
    $("nearby").hidden = !this.nearby;
    if (this.nearby) {
      const table = state?.tables.find((t) => t.id === this.nearby);
      const full = table?.match.players.every(Boolean);
      $("nearby-text").textContent =
        `Table ${this.nearby}${state?.players.some((p) => p.bot && p.table === this.nearby) ? " · House bot" : ""}`;
      $("join").hidden = !!full;
    }
  }
}
