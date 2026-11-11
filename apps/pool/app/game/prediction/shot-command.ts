import type { ClientMessage, ShotAck, Snapshot } from "@harrhy/pool-protocol";
export type ShotCommand = Extract<ClientMessage, { type: "shot" }>;
export type Shot = Pick<ShotCommand, "table" | "turn" | "angle" | "power">;
export class ShotCommands {
  pending: {
    command: ShotCommand;
    at: number;
    lastSent: number;
    accepted: boolean;
    warned: boolean;
  } | null = null;
  constructor(
    private send: (command: ShotCommand) => boolean,
    private warn: (text: string) => void,
  ) {}
  start(shot: Shot): ShotCommand | null {
    if (this.pending) return null;
    const command: ShotCommand = {
      type: "shot",
      id: crypto.randomUUID(),
      ...shot,
    };
    if (!this.send(command)) return null;
    const now = performance.now();
    this.pending = {
      command,
      at: now,
      lastSent: now,
      accepted: false,
      warned: false,
    };
    return command;
  }
  cancel() {
    this.pending = null;
  }
  acknowledge(message: ShotAck) {
    if (this.pending?.command.id !== message.id) return false;
    if (message.accepted) this.pending.accepted = true;
    else this.pending = null;
    return !message.accepted;
  }
  ingest(next: Snapshot) {
    const pending = this.pending;
    if (!pending) return;
    const table = next.tables.find((t) => t.id === pending.command.table);
    if (
      !table ||
      table.match.phase === "rolling" ||
      table.match.shotNumber !== pending.command.turn
    )
      this.cancel();
  }
  tick(now: number) {
    const pending = this.pending;
    if (!pending) return;
    if (now - pending.at > 3000 && !pending.warned) {
      pending.warned = true;
      this.warn("Still waiting for shot confirmation…");
    } else if (!pending.accepted && now - pending.lastSent >= 400) {
      if (this.send(pending.command)) pending.lastSent = now;
    }
  }
}
