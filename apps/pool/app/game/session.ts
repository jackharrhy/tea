import { PROTOCOL_VERSION } from "@harrhy/pool-protocol";
import type { ClientMessage, ServerMessage } from "@harrhy/pool-protocol";
interface SessionEvents {
  message(message: ServerMessage): void;
  closed(): void;
  status(text: string): void;
  notice(text: string): void;
}
export class Session {
  private socket: WebSocket | null = null;
  private reconnects = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  connected = false;
  constructor(
    private identity: () => { name: string; color: number },
    private events: SessionEvents,
  ) {}
  send(message: ClientMessage) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }
  connect(preview = false) {
    if (this.disposed) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.events.status(this.reconnects ? "Reconnecting…" : "Joining…");
    const ws = new WebSocket(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws${preview ? "?watch=1" : ""}`,
    );
    const previous = this.socket;
    this.socket = ws;
    previous?.close();
    ws.addEventListener("open", () => {
      if (preview || ws !== this.socket) return;
      this.send({
        type: "hello",
        version: PROTOCOL_VERSION,
        ...this.identity(),
        token: sessionStorage.getItem("8ball.token") ?? undefined,
      });
    });
    ws.addEventListener("message", (event) => {
      if (ws !== this.socket) return;
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.type === "welcome") {
        sessionStorage.setItem("8ball.token", message.token);
        this.connected = true;
        this.reconnects = 0;
      }
      this.events.message(message);
    });
    ws.addEventListener("close", (event) => {
      if (ws !== this.socket) return;
      this.connected = false;
      this.events.closed();
      if (event.code === 4001) {
        this.events.status("Session opened in another tab");
        this.events.notice(
          "This session moved to another tab. Refresh to join again.",
        );
        return;
      }
      this.events.status("Connection lost. Reconnecting…");
      this.events.notice("Connection lost. Reconnecting…");
      this.reconnectTimer = setTimeout(
        () => this.connect(preview),
        Math.min(1000 * 2 ** this.reconnects++, 10_000),
      );
    });
    ws.addEventListener("error", () => {
      if (ws === this.socket)
        this.events.status("Cannot reach the hall. Retrying…");
    });
  }
  dispose() {
    this.disposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const socket = this.socket;
    this.socket = null;
    this.connected = false;
    socket?.close();
  }
}
