import { TABLES, type Point } from "@harrhy/pool-simulation";
import type {
  ClientMessage,
  Snapshot,
  TableState,
  ServerMessage,
} from "@harrhy/pool-protocol";
import { GameAudio } from "./audio";
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
  private readonly nameInput: HTMLInputElement;
  private readonly colorInput: HTMLInputElement;
  private chatOpen = false;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly abort = new AbortController();
  nearby: string | null = null;
  constructor(
    private audio: GameAudio,
    readonly root: HTMLElement,
    readonly canvas: HTMLCanvasElement,
  ) {
    this.nameInput = this.element("name");
    this.colorInput = this.element("player-color");
    const savedColor = localStorage.getItem("8ball.color");
    if (savedColor && /^#[0-9a-f]{6}$/i.test(savedColor))
      this.colorInput.value = savedColor;
    if (!this.nameInput.value)
      this.nameInput.value = localStorage.getItem("8ball.name") ?? "";
  }
  private element<T extends HTMLElement = HTMLElement>(id: string): T {
    const element = this.root.querySelector<T>(`#${id}`);
    if (!element) throw new Error(`Pool UI element missing: ${id}`);
    return element;
  }
  identity() {
    return {
      name: this.nameInput.value.trim() || "Guest",
      color: Number.parseInt(this.colorInput.value.slice(1), 16),
    };
  }
  ready() {
    this.status("Enter the hall");
    this.element("entry").querySelector<HTMLButtonElement>("button")!.disabled =
      false;
  }
  failed() {
    this.element("connection").classList.remove("sr-only");
    this.status(
      "The 3D renderer could not start. Try another browser or enable hardware acceleration.",
    );
  }
  status(text: string) {
    this.element("connection").textContent = text;
  }
  welcome() {
    this.element("entry").hidden = true;
    this.element("menu").hidden =
      this.element("chat-toggle").hidden =
      this.element("invite").hidden =
        false;
    this.canvas.focus();
  }
  toast(text: string) {
    this.element("toast").textContent = text;
    this.element("toast").hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(
      () => (this.element("toast").hidden = true),
      4500,
    );
  }

  chat(message: Extract<ServerMessage, { type: "chat" }>) {
    const item = document.createElement("li"),
      name = document.createElement("b");
    name.textContent = `${message.name} `;
    item.append(name, document.createTextNode(message.text));
    this.element("messages").append(item);
    while (this.element("messages").children.length > 40)
      this.element("messages").firstChild?.remove();
    this.element("messages").scrollTop = this.element("messages").scrollHeight;
  }
  closeMenu() {
    const menu = this.element<HTMLDetailsElement>("menu");
    const wasOpen = menu.open;
    menu.open = false;
    return wasOpen;
  }
  closeChat() {
    this.chatOpen = false;
    this.element("chat-form").hidden = true;
    this.element("chat-toggle").setAttribute("aria-expanded", "false");
  }
  openChat() {
    this.chatOpen = true;
    this.element("chat-form").hidden = false;
    this.element("chat-toggle").setAttribute("aria-expanded", "true");
    this.element<HTMLInputElement>("chat-input").focus();
  }
  private updateSoundLabel() {
    this.element("sound").textContent = this.audio.enabled
      ? "Sound on"
      : "Sound off";
    this.element("sound").setAttribute(
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
    listen(this.element("entry"), "submit", (event) => {
      event.preventDefault();
      if (!this.nameInput.value.trim()) return;
      localStorage.setItem("8ball.name", this.nameInput.value.trim());
      localStorage.setItem("8ball.color", this.colorInput.value);
      this.element("entry").querySelector<HTMLButtonElement>(
        "button",
      )!.disabled = true;
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
      listen(this.element(action), "click", () => actions.action(action));
    listen(this.element("chat-toggle"), "click", () => {
      if (this.chatOpen) {
        this.closeChat();
        this.canvas.focus();
      } else this.openChat();
    });
    listen(this.element("chat-input"), "focus", () => {
      actions.clearKeys();
      actions.cancelShot();
    });
    listen(this.element("chat-form"), "submit", (event) => {
      event.preventDefault();
      const input = this.element<HTMLInputElement>("chat-input");
      if (input.value.trim()) {
        actions.send({ type: "chat", text: input.value.trim() });
        input.value = "";
      }
      this.closeChat();
      this.canvas.focus();
    });
    listen(this.element("chat-input"), "keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.closeChat();
        this.canvas.focus();
      }
    });
    listen(this.element("invite"), "click", async () => {
      try {
        await navigator.clipboard.writeText(location.origin);
        this.toast("Link copied. Send it to a friend.");
      } catch {
        this.toast(`Invite a friend: ${location.origin}`);
      }
    });
    listen(this.element("sound"), "click", () => {
      const soundEnabled = this.audio.toggle();
      localStorage.setItem("8ball.sound", soundEnabled ? "on" : "off");
      this.updateSoundLabel();
      if (soundEnabled) this.audio.preview();
    });
    listen(this.element("menu"), "toggle", () => {
      if (this.element<HTMLDetailsElement>("menu").open) actions.cancelShot();
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
      listen(this.element(action), "click", () => {
        actions.cancelShot();
        this.element<HTMLDetailsElement>("menu").open = false;
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
      this.element("connection").textContent =
        `${state.players.filter((p) => p.connected && !p.bot).length} in hall · ${state.players.filter((p) => p.bot).length} bot`;
    this.element("touch").hidden =
      !entered ||
      !!focusTable ||
      !!own?.table ||
      !matchMedia("(pointer:coarse)").matches;
    const table = currentTable();
    this.element("table-ui").hidden = !entered || !table;
    if (table) {
      const match = table.match;
      const score = this.element("score");
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
      this.element("turn").textContent =
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
      this.element("message").textContent =
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
      this.element("leave").hidden = own?.table !== table.id;
      this.element("take-seat").hidden =
        !!own?.table || match.players.every(Boolean);
      this.element("rematch").hidden =
        own?.table !== table.id || match.phase !== "finished";
      const ready = table.rematchReady.includes(id);
      this.element<HTMLButtonElement>("rematch").disabled =
        !connected ||
        ready ||
        !match.players.every(
          (player) => state?.players.find((p) => p.id === player)?.connected,
        );
      this.element("rematch").textContent = ready
        ? "Waiting for opponent"
        : "Play again";
      this.element("back").textContent =
        own?.table === table.id ? "View hall" : "Back to hall";
    }
    this.updateNearby(state, id, entered, focusTable, position);
    this.element("back").hidden = !focusTable;
    this.element("leave").hidden = !own?.table;
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
      this.element("nearby").hidden = true;
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
    this.element("nearby").hidden = !this.nearby;
    if (this.nearby) {
      const table = state?.tables.find((t) => t.id === this.nearby);
      const full = table?.match.players.every(Boolean);
      this.element("nearby-text").textContent =
        `Table ${this.nearby}${state?.players.some((p) => p.bot && p.table === this.nearby) ? " · House bot" : ""}`;
      this.element("join").hidden = !!full;
    }
  }
}
