import { loadConfig } from "./config";
import { closeDb, createDb } from "./db";
import { createApplication } from "./http-app";
import { startPoller } from "./services/poller";
import { startScheduler } from "./services/scheduler";
import { bootstrapOwner } from "./bootstrap";
import {
  rescheduleInterruptedCampaigns,
  startDeliveryWorker,
} from "./services/delivery-worker";
import { cleanupExpiredAuthRecords } from "./services/auth-maintenance";
import { requeueInterruptedWork, runGracefulShutdown } from "./shutdown";

const config = loadConfig();
const db = createDb(config.dbPath);
if (!config.identity) await bootstrapOwner(db, config);
cleanupExpiredAuthRecords(db);
const interruptedCampaigns = rescheduleInterruptedCampaigns(db);
if (interruptedCampaigns > 0) {
  console.warn(
    `Queued ${interruptedCampaigns} interrupted campaign(s) to resume`,
  );
}

const app = createApplication(db, config);
const workerController = new AbortController();
config.shutdownSignal = workerController.signal;
let shuttingDown = false;
const workerTasks: Promise<void>[] = [];

const port = Number(process.env.PORT ?? 8080);
console.log(`lists running on :${port}`);
app.listen(port);

async function shutdown(reason: string, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Shutting down (${reason})`);
  const result = await runGracefulShutdown({
    abort: () => workerController.abort(),
    stopAdmission: () => app.stop(false),
    forceStop: () => app.stop(true),
    work: workerTasks,
    requeue: () => requeueInterruptedWork(db),
    close: () => closeDb(db),
    timeoutMs: 30_000,
  });
  if (result.timedOut)
    console.warn("Shutdown drain timed out; active connections were closed");
  console.log(
    `Shutdown complete; requeued ${result.requeued.deliveries} deliveries and ${result.requeued.campaigns} campaigns`,
  );
  process.exit(exitCode);
}

function startWorker(name: string, work: Promise<void>) {
  workerTasks.push(
    work.catch((error) => {
      if (workerController.signal.aborted) return;
      console.error(`${name} crashed:`, error);
      void shutdown(`${name} failure`, 1);
    }),
  );
}

startWorker("Poller", startPoller(db, config, workerController.signal));
startWorker("Scheduler", startScheduler(db, config, workerController.signal));
startWorker(
  "Delivery worker",
  startDeliveryWorker(db, config, workerController.signal),
);

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

export default app;
