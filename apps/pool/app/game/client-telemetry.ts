import type { ClientDiagnostic } from "@harrhy/pool-protocol";

const meaningful = (window: ClientDiagnostic): boolean =>
  window.count >= 3 || window.maxError >= (window.kind === "pool" ? 0.05 : 0.1);

/** One active window per kind and at most eight completed context windows. */
export class ClientTelemetry {
  private windows = new Map<ClientDiagnostic["kind"], ClientDiagnostic>();
  private pending: ClientDiagnostic[] = [];
  private started: number;
  private poolContext:
    | { table: string | null; rack: number | null }
    | undefined;
  private lastPacket: number | undefined;
  private maxPacketGapMs = 0;

  constructor(now: number) {
    this.started = now;
  }

  context(table: string | null, rack: number | null): void {
    if (this.poolContext?.table !== table || this.poolContext?.rack !== rack) {
      this.windows.delete("pool");
      this.pending = this.pending.filter((window) => window.kind !== "pool");
    }
    this.poolContext = { table, rack };
  }

  packet(now: number): void {
    if (this.lastPacket !== undefined)
      this.maxPacketGapMs = Math.max(
        this.maxPacketGapMs,
        Math.min(60000, Math.max(0, now - this.lastPacket)),
      );
    this.lastPacket = now;
  }

  correction(
    kind: ClientDiagnostic["kind"],
    table: string | null,
    turn: number | null,
    error: number,
  ): void {
    if (!Number.isFinite(error) || error <= 0.001) return;
    let window = this.windows.get(kind);
    // Retain completed shots with their original context until the timed flush.
    if (!window || window.table !== table || window.turn !== turn) {
      if (window && meaningful(window)) {
        this.pending.push(window);
        this.pending.sort((a, b) => b.maxError - a.maxError);
        if (this.pending.length > 8) this.pending.length = 8;
      }
      window = {
        type: "diagnostic",
        kind,
        table,
        turn,
        durationMs: 1,
        count: 0,
        maxError: 0,
        errorBins: [0, 0, 0, 0],
        maxPacketGapMs: 0,
      };
      this.windows.set(kind, window);
    }
    if (window.count === 65535) return;
    window.count++;
    window.maxError = Math.max(window.maxError, Math.min(100, error));
    window.errorBins[
      error <= 0.025 ? 0 : error <= 0.1 ? 1 : error <= 0.5 ? 2 : 3
    ]++;
  }

  flush(now: number): ClientDiagnostic[] {
    if (now - this.started < 10000) return [];
    const reports = [...this.pending, ...this.windows.values()]
      .filter(meaningful)
      .toSorted((a, b) => b.maxError - a.maxError)
      .map((window) =>
        window.durationMs === 1
          ? {
              ...window,
              durationMs: Math.min(60000, now - this.started),
              maxPacketGapMs: this.maxPacketGapMs,
            }
          : window,
      );
    this.windows.clear();
    this.pending = reports.slice(4, 12);
    this.started = now;
    this.maxPacketGapMs = 0;
    return reports.slice(0, 4);
  }
}
