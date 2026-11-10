import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { schema } from "../src/db";
import { requeueInterruptedWork, runGracefulShutdown } from "../src/shutdown";
import { createTestDb, seedSubscriber } from "./helpers";

test("shutdown requeues active durable delivery state immediately", () => {
  const db = createTestDb();
  const subscriber = seedSubscriber(db);
  const campaign = db
    .insert(schema.campaigns)
    .values({
      subject: "Interrupted",
      bodyMarkdown: "Body",
      fromAddress: "list@example.com",
      audienceType: "all",
      status: "sending",
    })
    .returning()
    .get();
  const delivery = db
    .insert(schema.campaignSends)
    .values({
      campaignId: campaign.id,
      subscriberId: subscriber.id,
      status: "attempting",
    })
    .returning()
    .get();
  const now = new Date("2026-11-10T12:00:00.000Z");

  expect(requeueInterruptedWork(db, now)).toEqual({
    deliveries: 1,
    campaigns: 1,
  });
  expect(
    db
      .select()
      .from(schema.campaignSends)
      .where(eq(schema.campaignSends.id, delivery.id))
      .get(),
  ).toMatchObject({
    status: "deferred",
    nextAttemptAt: now.toISOString(),
    lastError: "Application shutdown interrupted delivery",
  });
  expect(
    db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaign.id))
      .get(),
  ).toMatchObject({
    status: "scheduled",
    scheduledAt: now.toISOString(),
    lastError: "Application shutdown interrupted delivery",
  });
});

test("graceful shutdown stops admission, drains work, then requeues and closes", async () => {
  const events: string[] = [];
  let finishWork!: () => void;
  const work = new Promise<void>((resolve) => {
    finishWork = () => {
      events.push("work stopped");
      resolve();
    };
  });

  const result = await runGracefulShutdown({
    abort: () => {
      events.push("aborted");
      finishWork();
    },
    stopAdmission: async () => {
      events.push("admission stopped");
    },
    forceStop: async () => {
      events.push("forced");
    },
    work: [work],
    requeue: () => {
      events.push("requeued");
      return { deliveries: 0, campaigns: 0 };
    },
    close: () => events.push("closed"),
    timeoutMs: 100,
  });

  expect(result.timedOut).toBeFalse();
  expect(events).toEqual([
    "admission stopped",
    "aborted",
    "work stopped",
    "requeued",
    "closed",
  ]);
});

test("graceful shutdown force-stops after its bound and still closes", async () => {
  const events: string[] = [];
  const never = new Promise<void>(() => {});

  const result = await runGracefulShutdown({
    abort: () => events.push("aborted"),
    stopAdmission: () => never,
    forceStop: async () => events.push("forced"),
    work: [never],
    requeue: () => {
      events.push("requeued");
      return { deliveries: 1, campaigns: 1 };
    },
    close: () => events.push("closed"),
    timeoutMs: 5,
  });

  expect(result).toEqual({
    timedOut: true,
    requeued: { deliveries: 1, campaigns: 1 },
  });
  expect(events).toEqual(["aborted", "forced", "requeued", "closed"]);
});
