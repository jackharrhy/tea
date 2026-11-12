import {
  poolTraceSchema,
  MAX_POOL_TRACE_BYTES,
  MAX_POOL_TRACE_RAW_BYTES,
  type PoolTrace,
  type PoolTraceCorrection,
  type PoolTraceMessage,
  type ShotAck,
  type Snapshot,
} from "@harrhy/pool-protocol";
import type { PhysicalBall } from "@harrhy/pool";
import type { MotionEntity } from "./prediction/net-state";

const copy = <T>(value: T): T => structuredClone(value);
function poses(
  values: MotionEntity[],
  table: string,
): PoolTrace["frames"][number]["rendered"] {
  const prefix = `ball:${table}:`;
  return values
    .filter((p) => p.id.startsWith(prefix))
    .slice(0, 16)
    .map((p) => ({
      id: Number(p.id.slice(prefix.length)),
      x: p.x,
      y: p.y,
      z: p.z,
      epoch: p.epoch,
      ...(p.q
        ? {
            q: [p.q.x, p.q.y, p.q.z, p.q.w] as [number, number, number, number],
          }
        : {}),
    }));
}
type Capture = {
  context: PoolTrace["context"];
  trigger?: PoolTrace["trigger"];
  packets: PoolTrace["packets"];
  frames: PoolTrace["frames"];
  corrections: PoolTrace["corrections"];
  transmissions: PoolTrace["transmissions"];
  acknowledgements: PoolTrace["acknowledgements"];
  omitted: PoolTrace["omitted"];
};

export class PoolTraceCapture {
  private current: Capture | null = null;
  private ready: PoolTrace | null = null;
  private lastTrigger = -Infinity;
  private used = new Set<string>();
  private lastFrame = -Infinity;
  private maximumFrameMs = 0;
  private lastPacket: number | undefined;

  begin(context: PoolTrace["context"], now: number) {
    if (this.current?.trigger) this.finish(now, true);
    this.current = null;
    if (this.used.has(context.command.id) || now - this.lastTrigger < 30000)
      return;
    this.current = {
      context: copy(context),
      packets: [],
      frames: [],
      corrections: [],
      transmissions: [context.sentAt],
      acknowledgements: [],
      omitted: { frames: 0, packets: 0, corrections: 0 },
    };
    this.lastFrame = -Infinity;
    this.maximumFrameMs = 0;
    this.lastPacket = undefined;
  }
  private collecting(now: number) {
    if (this.current?.trigger && now > this.current.trigger.at + 1000)
      this.finish(now, false);
    return this.current;
  }
  packet(
    snapshot: Snapshot,
    now: number,
    accepted = true,
    clockOffsetMs?: number | null,
  ) {
    const current = this.collecting(now);
    if (!current) return;
    const table = snapshot.tables.find(
      (t) => t.id === current.context.command.table,
    );
    if (!table || (accepted && table.rack !== current.context.rack)) {
      if (current.trigger) this.finish(now, true);
      else this.current = null;
      return;
    }
    const gapMs = this.lastPacket === undefined ? 0 : now - this.lastPacket;
    this.lastPacket = now;
    const estimate =
      clockOffsetMs ??
      Math.min(
        now - snapshot.time,
        ...current.packets
          .filter((p) => p.accepted)
          .map((p) => p.receivedAt - p.serverTime),
      );
    current.packets.push({
      receivedAt: now,
      serverTick: snapshot.tick,
      serverTime: snapshot.time,
      estimatedOffsetMs: estimate,
      gapMs,
      rack: table.rack,
      accepted,
      turn: table.match.shotNumber,
      phase: table.match.phase,
      balls: copy(table.balls),
    });
    this.prune(now);
  }
  sent(commandId: string, now: number) {
    const current = this.collecting(now);
    if (
      current?.context.command.id === commandId &&
      current.transmissions.length < 16
    )
      current.transmissions.push(now);
  }
  acknowledge(ack: ShotAck, now: number) {
    const current = this.collecting(now);
    if (
      !current ||
      ack.id !== current.context.command.id ||
      ack.table !== current.context.command.table ||
      ack.turn !== current.context.command.turn
    )
      return;
    current.acknowledgements.push({
      receivedAt: now,
      accepted: ack.accepted,
      serverTime: ack.time,
    });
    if (current.acknowledgements.length > 8) current.acknowledgements.shift();
    if (!ack.accepted) this.current = null;
  }
  frame(
    now: number,
    rawFrameMs: number,
    state: {
      tick: number;
      droppedSteps: number;
      balls: readonly PhysicalBall[];
    },
    rendered: MotionEntity[],
  ) {
    const current = this.collecting(now);
    if (!current) return;
    if (!state.balls.length && !current.trigger) {
      this.current = null;
      return;
    }
    this.maximumFrameMs = Math.max(this.maximumFrameMs, rawFrameMs);
    if (now - this.lastFrame < 50) return;
    current.frames.push({
      at: now,
      rawFrameMs: this.maximumFrameMs,
      simulationTick: state.tick,
      droppedSteps: state.droppedSteps,
      predicted: copy([...state.balls]),
      rendered: poses(rendered, current.context.command.table),
    });
    this.lastFrame = now;
    this.maximumFrameMs = 0;
    this.prune(now);
  }
  correction(event: PoolTraceCorrection) {
    const current = this.collecting(event.at);
    if (!current) return;
    current.corrections.push(copy(event));
    this.prune(event.at);
    const repeated =
      current.corrections.filter(
        (c) => c.at >= event.at - 1000 && c.error >= 0.025,
      ).length >= 3;
    if (!current.trigger && (event.error >= 0.1 || repeated)) {
      current.trigger = {
        at: event.at,
        error: event.error,
        reason:
          event.error >= 0.1 ? "large-correction" : "repeated-corrections",
      };
      this.lastTrigger = event.at;
      this.used.add(current.context.command.id);
      if (this.used.size > 32)
        this.used.delete(this.used.values().next().value!);
    }
  }
  private prune(now: number) {
    const c = this.current!;
    const cutoff = (c.trigger?.at ?? now) - 2000;
    c.frames = c.frames.filter((f) => f.at >= cutoff);
    c.packets = c.packets.filter((p) => p.receivedAt >= cutoff);
    c.corrections = c.corrections.filter((e) => e.at >= cutoff);
    for (const [key, limit] of [
      ["frames", 64],
      ["packets", 128],
      ["corrections", 32],
    ] as const) {
      const excess = Math.max(0, c[key].length - limit);
      if (excess) {
        c[key].splice(0, excess);
        c.omitted[key] += excess;
      }
    }
  }
  private finish(now: number, partial: boolean) {
    const c = this.current;
    if (!c?.trigger) {
      this.current = null;
      return;
    }
    this.prune(now);
    this.ready = {
      formatVersion: 1,
      id: crypto.randomUUID(),
      context: c.context,
      trigger: c.trigger,
      window: {
        start: Math.max(0, c.trigger.at - 2000),
        end: Math.min(now, c.trigger.at + 1000),
        partial,
      },
      packets: c.packets,
      frames: c.frames,
      corrections: c.corrections,
      transmissions: c.transmissions,
      acknowledgements: c.acknowledgements,
      omitted: c.omitted,
    };
    this.current = null;
  }
  take(now: number): PoolTrace | null {
    if (this.current?.trigger && now >= this.current.trigger.at + 1000)
      this.finish(now, false);
    const ready = this.ready;
    this.ready = null;
    return ready;
  }
  reset() {
    this.current = null;
    this.ready = null;
  }
}

function thin<T>(values: T[]) {
  return values.filter((_, i) => i % 2 === 0 || i === values.length - 1);
}
export async function encodePoolTrace(
  input: PoolTrace,
): Promise<PoolTraceMessage | null> {
  const trace = poolTraceSchema.parse(copy(input));
  while (true) {
    const raw = new TextEncoder().encode(JSON.stringify(trace));
    if (raw.byteLength <= MAX_POOL_TRACE_RAW_BYTES) {
      const stream = new Blob([raw])
        .stream()
        .pipeThrough(new CompressionStream("gzip"));
      const compressed = new Uint8Array(
        await new Response(stream).arrayBuffer(),
      );
      if (compressed.byteLength <= MAX_POOL_TRACE_BYTES) {
        let binary = "";
        for (let i = 0; i < compressed.length; i += 4096)
          binary += String.fromCharCode(...compressed.subarray(i, i + 4096));
        const { command, rack } = trace.context;
        return {
          type: "pool-trace",
          id: trace.id,
          table: command.table,
          turn: command.turn,
          commandId: command.id,
          rack,
          payload: btoa(binary),
        };
      }
    }
    if (trace.frames.length <= 2 && trace.packets.length <= 2) {
      const triggerIndex = trace.corrections.findIndex(
        (c) => c.at === trace.trigger.at && c.error === trace.trigger.error,
      );
      const required = new Set([triggerIndex]);
      if (trace.trigger.reason === "repeated-corrections") {
        const supporting = trace.corrections
          .map((c, i) => ({ c, i }))
          .filter(
            ({ c, i }) =>
              i !== triggerIndex &&
              c.at <= trace.trigger.at &&
              c.at >= trace.trigger.at - 1000 &&
              c.error >= 0.025,
          );
        for (const { i } of supporting.slice(-2)) required.add(i);
      }
      if (trace.corrections.length === required.size) return null;
      const ranked = trace.corrections
        .map((c, i) => ({ c, i }))
        .toSorted((a, b) => b.c.error - a.c.error);
      const limit = Math.max(
        required.size,
        Math.ceil(trace.corrections.length / 2),
      );
      for (const { i } of ranked) {
        if (required.size >= limit) break;
        required.add(i);
      }
      trace.omitted.corrections += trace.corrections.length - required.size;
      trace.corrections = trace.corrections.filter((_, i) => required.has(i));
      continue;
    }
    const before = [trace.frames.length, trace.packets.length];
    trace.frames = thin(trace.frames);
    trace.packets = thin(trace.packets);
    trace.omitted.frames += before[0] - trace.frames.length;
    trace.omitted.packets += before[1] - trace.packets.length;
  }
}
