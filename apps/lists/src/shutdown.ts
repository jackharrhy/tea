import type { Db } from "./db";
import { schema } from "./db";
import { eq, inArray } from "drizzle-orm";

export function requeueInterruptedWork(
  db: Db,
  now = new Date(),
  reason = "Application shutdown interrupted delivery",
) {
  const timestamp = now.toISOString();
  return db.transaction((tx) => {
    const deliveries = tx
      .update(schema.campaignSends)
      .set({
        status: "deferred",
        nextAttemptAt: timestamp,
        lastError: reason,
        updatedAt: timestamp,
      })
      .where(inArray(schema.campaignSends.status, ["pending", "attempting"]))
      .returning({ id: schema.campaignSends.id })
      .all();
    const campaigns = tx
      .update(schema.campaigns)
      .set({ status: "scheduled", scheduledAt: timestamp, lastError: reason })
      .where(eq(schema.campaigns.status, "sending"))
      .returning({ id: schema.campaigns.id })
      .all();
    return { deliveries: deliveries.length, campaigns: campaigns.length };
  });
}

type ShutdownOptions<T> = {
  abort: () => void;
  stopAdmission: () => Promise<unknown>;
  forceStop: () => Promise<unknown>;
  work: Promise<unknown>[];
  requeue: () => T;
  close: () => void;
  timeoutMs: number;
};

export async function runGracefulShutdown<T>(options: ShutdownOptions<T>) {
  const admission = options.stopAdmission();
  options.abort();
  const draining = Promise.allSettled([admission, ...options.work]);
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    draining,
    new Promise<void>((resolve) => {
      timeout = setTimeout(() => {
        timedOut = true;
        resolve();
      }, options.timeoutMs);
    }),
  ]);
  if (timeout) clearTimeout(timeout);
  if (timedOut) await options.forceStop();
  const requeued = options.requeue();
  options.close();
  return { timedOut, requeued };
}
