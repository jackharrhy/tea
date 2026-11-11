import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { chromium, type Browser, type Page } from "playwright-core";
import { compileWorld, PLAYER_HALF_HEIGHT } from "@harrhy/gurgur-game";
import { createGurgurServer } from "../server/src/server";
import type { PredictionTraceFrame } from "../web/src/prediction-trace";

type BrowserImpairment = {
  oneWayLatencyMs: number;
  jitterMs: number;
  lossRate: number;
  seed: number;
};

const LOCAL_IMPAIRMENT: BrowserImpairment = {
  oneWayLatencyMs: 0,
  jitterMs: 0,
  lossRate: 0,
  seed: 0x100,
};
const TYPICAL_IMPAIRMENT: BrowserImpairment = {
  oneWayLatencyMs: 40,
  jitterMs: 10,
  lossRate: 0.01,
  seed: 0x200,
};
const ADVERSE_IMPAIRMENT: BrowserImpairment = {
  oneWayLatencyMs: 75,
  jitterMs: 20,
  lossRate: 0.05,
  seed: 0x300,
};
const pickupProfiles = {
  local: LOCAL_IMPAIRMENT,
  typical: TYPICAL_IMPAIRMENT,
  adverse: ADVERSE_IMPAIRMENT,
};
const pickupProfile = process.env.SMOKE_PROFILE;
if (pickupProfile && !Object.hasOwn(pickupProfiles, pickupProfile))
  throw new Error("SMOKE_PROFILE must be local, typical, or adverse");

const scenario = process.env.SMOKE_SCENARIO ?? "all";
const path = "content/maps/fixtures/network-boxes.map";
const bundle = compileWorld(await Bun.file(path).text(), path);
const prop = bundle.entities.find(
  (entity) =>
    entity.kind === "physics-prop" && entity.body.brushIndices.length === 1,
);
if (!prop) throw new Error("browser pickup fixture is unavailable");
const brush = bundle.brushes[prop.body!.brushIndices[0]!]!;
const spawn = {
  x: brush.center.x,
  y: PLAYER_HALF_HEIGHT,
  z: brush.center.z + 2.5,
};
const directory = await mkdtemp(join(tmpdir(), "gurgur-browser-v7-"));
const adminToken = "browser-v7-admin";
const server = await createGurgurServer({
  port: 0,
  hostname: "127.0.0.1",
  databasePath: join(directory, "world.sqlite"),
  worldBundle: bundle,
  playerSpawn: spawn,
  adminToken,
});
const executablePath =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chromeOptions = {
  executablePath,
  headless: true,
  args: ["--enable-unsafe-webgpu"],
};
const chrome = await chromium.launch(chromeOptions);
const peerChrome = await chromium.launch(chromeOptions);

try {
  if (scenario === "all" || scenario === "movement") {
    await resetWorld();
    await movementAndBanding(chrome, peerChrome);
  }
  if (scenario === "all" || scenario === "pickup") {
    for (const [profile, impairment] of Object.entries(pickupProfiles)) {
      if (pickupProfile && pickupProfile !== profile) continue;
      await resetWorld();
      await pickupAndRelease(chrome, profile, impairment);
    }
  }
  if (scenario === "all" || scenario === "contention") {
    await resetWorld();
    await contentionAndRecovery(chrome, peerChrome);
  }
  if (scenario === "all" || scenario === "contraption")
    await contraptionInteraction(chrome);
  if (scenario === "capture") {
    await resetWorld();
    await debugPhysicsCapture(chrome);
  }
  console.log(`protocol-v7 browser smoke passed (${scenario})`);
} finally {
  await Promise.all([chrome.close(), peerChrome.close()]);
  server.stop();
  await rm(directory, { recursive: true, force: true });
}

async function resetWorld(): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${server.port}/admin/reset`, {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken}` },
  });
  if (!response.ok)
    throw new Error(`browser fixture reset failed (${response.status})`);
}

async function movementAndBanding(
  ownerBrowser: Browser,
  observerBrowser: Browser,
): Promise<void> {
  const owner = await openPage(ownerBrowser, LOCAL_IMPAIRMENT);
  const observer = await openPage(observerBrowser, ADVERSE_IMPAIRMENT);
  try {
    const ownerId = await localPlayerKey(owner);
    await owner.waitForFunction(() =>
      Boolean(
        document.querySelector<HTMLElement>("#gurgur-root")!.dataset
          .interactionTarget,
      ),
    );
    const localBodyId = await owner.evaluate(
      () =>
        document.querySelector<HTMLElement>("#gurgur-root")!.dataset
          .interactionTarget!,
    );
    await observer.waitForFunction(
      (id) =>
        (window as unknown as SmokeWindow).__gurgurDiagnostics
          .presentation()
          .some((state) => state.runtimeId === id),
      ownerId,
    );
    await owner.locator("canvas").focus();
    const before = await position(owner, ownerId);
    const responseMs = await owner.evaluate(
      ({ id, z }) =>
        new Promise<number>((resolve, reject) => {
          const started = performance.now();
          (window as unknown as SmokeWindow).__gurgurSmokePad.axes[1] = 1;
          const sample = (): void => {
            const state = (window as unknown as SmokeWindow).__gurgurDiagnostics
              .presentation()
              .find((candidate) => candidate.runtimeId === id);
            if (state && Math.abs(state.position.z - z) > 0.015) {
              resolve(performance.now() - started);
              return;
            }
            if (performance.now() - started > 500) {
              reject(new Error("local owner did not move"));
              return;
            }
            requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        }),
      { id: ownerId, z: before.z },
    );
    const responseStages = await owner.evaluate(() => ({
      input: Number(
        document.querySelector<HTMLElement>("#gurgur-root")!.dataset
          .inputMovementStartedAt,
      ),
      worker: Number(
        document.querySelector<HTMLElement>("#gurgur-root")!.dataset
          .ownerStateAt,
      ),
      presented: Number(
        document.querySelector<HTMLElement>("#gurgur-root")!.dataset
          .localPresentedAt,
      ),
    }));
    const inputToPresentation = responseStages.presented - responseStages.input;
    if (
      !Object.values(responseStages).every(Number.isFinite) ||
      inputToPresentation > 75
    )
      throw new Error(
        `local owner response took ${responseMs.toFixed(1)}ms (${JSON.stringify(responseStages)})`,
      );

    const movingFrames = await observer.evaluate(
      (id) =>
        new Promise<{ eligible: number; advanced: number }>((resolve) => {
          let previous: number | null = null;
          let eligible = 0;
          let advanced = 0;
          const startedAt = performance.now();
          const sample = (now: number): void => {
            const state = (window as unknown as SmokeWindow).__gurgurDiagnostics
              .presentation()
              .find((candidate) => candidate.runtimeId === id);
            if (state && now - startedAt > 180) {
              if (previous !== null) {
                eligible += 1;
                if (Math.abs(state.position.z - previous) > 1e-5) advanced += 1;
              }
              previous = state.position.z;
            }
            if (now - startedAt >= 1_000) resolve({ eligible, advanced });
            else requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        }),
      ownerId,
    );
    await owner.evaluate(() => {
      (window as unknown as SmokeWindow).__gurgurSmokePad.axes[1] = 0;
    });
    const ratio = movingFrames.advanced / Math.max(1, movingFrames.eligible);
    if (movingFrames.eligible < 30 || ratio < 0.95) {
      const replication = await observer.evaluate(
        (id) =>
          (window as unknown as SmokeWindow).__gurgurDiagnostics
            .replication()
            .find((state) => state.runtimeId === id) ?? null,
        ownerId,
      );
      throw new Error(
        `remote presentation banded: ${movingFrames.advanced}/${movingFrames.eligible} advancing frames; ${JSON.stringify(replication)}`,
      );
    }
    const localFeel = await owner.evaluate(
      (target) => ({
        target,
        diagnostics: (
          window as unknown as SmokeWindow
        ).__gurgurDiagnostics.clientFeel(),
      }),
      localBodyId,
    );
    const localBodyDelay =
      localFeel.diagnostics.presentation.trackDelayTicks[localFeel.target];
    if (
      localFeel.diagnostics.presentation.networkDelayPolicy !==
        "adaptive-render" ||
      localBodyDelay === undefined ||
      localBodyDelay > 5
    )
      throw new Error(
        `localhost render delay did not adapt: ${JSON.stringify(localFeel)}`,
      );
    await assertNoDiscardedWorkerTime(owner);
    await assertNoDiscardedWorkerTime(observer);
    await proveMainThreadIsolation(owner);
    await proveWorkerStallAccounting(owner);
  } finally {
    await owner.close();
    await observer.close();
  }
}

async function pickupAndRelease(
  browser: Browser,
  profile: string,
  impairment: BrowserImpairment,
): Promise<void> {
  const page = await openPage(browser, impairment);
  try {
    try {
      await page.waitForFunction(
        () =>
          Boolean(
            document.querySelector<HTMLElement>("#gurgur-root")!.dataset
              .interactionTarget,
          ),
        undefined,
        {
          timeout: 5_000,
        },
      );
    } catch {
      const diagnostics = await page.evaluate(() => ({
        body: Object.fromEntries(
          Object.entries(
            document.querySelector<HTMLElement>("#gurgur-root")!.dataset,
          ),
        ),
        feel: (
          window as unknown as SmokeWindow
        ).__gurgurDiagnostics.clientFeel(),
        presentation: (
          window as unknown as SmokeWindow
        ).__gurgurDiagnostics.presentation(),
      }));
      throw new Error(
        `pickup target unavailable: ${JSON.stringify(diagnostics)}`,
      );
    }
    const targetId = await page.evaluate(
      () =>
        document.querySelector<HTMLElement>("#gurgur-root")!.dataset
          .interactionTarget!,
    );
    const initialAuthority = await page.evaluate((target) => {
      const entity = (window as unknown as SmokeWindow).__gurgurDiagnostics
        .network()
        .entities.find(
          (candidate) =>
            `${candidate.id.index}:${candidate.id.generation}` === target,
        );
      if (
        !entity ||
        entity.ownerPlayerId !== null ||
        entity.transferPolicy !== "fixed"
      )
        throw new Error("pickup target is not fixed-authority");
      return entity.authorityVersion;
    }, targetId);
    await pressPrimary(page);
    try {
      await page.waitForFunction(
        (target) =>
          (window as unknown as SmokeWindow).__gurgurDiagnostics.clientFeel()
            .prediction.held === target &&
          document.querySelector<HTMLElement>("#gurgur-root")!.dataset
            .interactionOutline === "held",
        targetId,
        { timeout: 5_000 },
      );
    } catch {
      const diagnostics = await page.evaluate(
        (target) => ({
          body: Object.fromEntries(
            Object.entries(
              document.querySelector<HTMLElement>("#gurgur-root")!.dataset,
            ),
          ),
          feel: (
            window as unknown as SmokeWindow
          ).__gurgurDiagnostics.clientFeel(),
          targetReplication: (
            window as unknown as SmokeWindow
          ).__gurgurDiagnostics
            .replication()
            .find((state) => state.runtimeId === target),
        }),
        targetId,
      );
      throw new Error(
        `server did not confirm loose pickup: ${JSON.stringify(diagnostics)}`,
      );
    }
    const pickupTrace = await tracePositions(page, targetId, 300);
    const pickupMaximumStep = maximumStep(pickupTrace);
    if (pickupTrace.length < 10 || pickupMaximumStep >= 0.25)
      throw new Error(
        `predicted pickup teleported: ${pickupTrace.length} frames, ${(pickupMaximumStep * 100).toFixed(2)}cm maximum step`,
      );
    const startPosition = await position(page, targetId);
    const previousLookAt = await page.evaluate(
      () =>
        document.querySelector<HTMLElement>("#gurgur-root")!.dataset.lookAt ??
        "",
    );
    const predictedResponse = page.evaluate(
      ({ target, previousLook }) =>
        new Promise<number>((resolve) => {
          let lookAt: number | null = null;
          let start: { x: number; y: number; z: number } | null = null;
          const startedAt = performance.now();
          const sample = (now: number): void => {
            const nextLook =
              document.querySelector<HTMLElement>("#gurgur-root")!.dataset
                .lookAt ?? "";
            const state = (window as unknown as SmokeWindow).__gurgurDiagnostics
              .presentation()
              .find((candidate) => candidate.runtimeId === target);
            if (lookAt === null && nextLook !== previousLook && state) {
              lookAt = Number(nextLook);
              start = { ...state.position };
            } else if (
              lookAt !== null &&
              start &&
              state &&
              Math.hypot(
                state.position.x - start.x,
                state.position.y - start.y,
                state.position.z - start.z,
              ) > 0.0001
            ) {
              resolve(now - lookAt);
              return;
            }
            if (now - startedAt >= 1_000) {
              resolve(Number.POSITIVE_INFINITY);
              return;
            }
            requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        }),
      { target: targetId, previousLook: previousLookAt },
    );
    await turnTouch(page, 450);
    const responseMs = await predictedResponse;
    // The response budget measures motion onset; acceleration limits travel distance.
    if (responseMs >= 75)
      throw new Error(
        `predicted held-prop response took ${responseMs.toFixed(1)}ms`,
      );
    await page.waitForFunction(
      ({ target, start }) => {
        const state = (window as unknown as SmokeWindow).__gurgurDiagnostics
          .presentation()
          .find((candidate) => candidate.runtimeId === target);
        return (
          state !== undefined &&
          Math.hypot(
            state.position.x - start.x,
            state.position.y - start.y,
            state.position.z - start.z,
          ) > 0.6
        );
      },
      { target: targetId, start: startPosition },
    );
    const releaseTrace = page.evaluate(
      (target) =>
        new Promise<Array<{ x: number; y: number; z: number; atMs: number }>>(
          (resolve) => {
            const samples: Array<{
              x: number;
              y: number;
              z: number;
              atMs: number;
            }> = [];
            const startedAt = performance.now();
            const sample = (now: number): void => {
              const state = (
                window as unknown as SmokeWindow
              ).__gurgurDiagnostics
                .presentation()
                .find((candidate) => candidate.runtimeId === target);
              if (state) samples.push({ ...state.position, atMs: now });
              if (now - startedAt >= 1_500) resolve(samples);
              else requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
          },
        ),
      targetId,
    );
    await pressPrimary(page);
    await page.waitForFunction(
      ({ target, authority }) => {
        const entity = (window as unknown as SmokeWindow).__gurgurDiagnostics
          .network()
          .entities.find(
            (candidate) =>
              `${candidate.id.index}:${candidate.id.generation}` === target,
          );
        return (
          entity?.ownerPlayerId === null &&
          entity.authorityVersion === authority &&
          (window as unknown as SmokeWindow).__gurgurDiagnostics.clientFeel()
            .prediction.held === null &&
          document.querySelector<HTMLElement>("#gurgur-root")!.dataset
            .interactionOutline !== "held"
        );
      },
      { target: targetId, authority: initialAuthority },
    );
    const samples = await releaseTrace;
    const releaseSteps = samples.slice(1).map((sample, index) => {
      const previous = samples[index]!;
      return {
        previous,
        sample,
        distance: Math.hypot(
          sample.x - previous.x,
          sample.y - previous.y,
          sample.z - previous.z,
        ),
      };
    });
    const worstReleaseStep = releaseSteps.toSorted(
      (left, right) => right.distance - left.distance,
    )[0];
    const maximumFrameStep = worstReleaseStep?.distance ?? 0;
    const predictionFrames = await page.evaluate(() =>
      (window as unknown as SmokeWindow).__gurgurDiagnostics.predictionTrace(),
    );
    await mkdir("reports/browser", { recursive: true });
    await Bun.write(
      `reports/browser/pickup-${profile}.json`,
      JSON.stringify({
        profile,
        targetId,
        release: samples,
        prediction: predictionFrames,
      }),
    );
    if (samples.length < 10 || maximumFrameStep >= 0.25)
      throw new Error(
        `host release trace was discontinuous: ${samples.length} frames, ${(maximumFrameStep * 100).toFixed(2)}cm maximum step (${JSON.stringify(worstReleaseStep?.previous)} -> ${JSON.stringify(worstReleaseStep?.sample)})`,
      );
    // Equal source ticks can reflect different input histories under jitter.
    await page.waitForFunction(
      (target) => {
        const diagnostics = (window as unknown as SmokeWindow)
          .__gurgurDiagnostics;
        const frame = diagnostics.predictionTrace().at(-1);
        const timelines = frame?.relevant.find(
          (body) => `${body.id.index}:${body.id.generation}` === target,
        )?.timelines;
        const host = timelines?.authoritative;
        const local = timelines?.predicted;
        const rendered = diagnostics
          .presentation()
          .find((body) => body.runtimeId === target);
        if (!host?.linearVelocity || !local?.linearVelocity || !rendered)
          return false;
        const error = (posePosition: {
          x: number;
          y: number;
          z: number;
        }): number =>
          Math.hypot(
            host.position.x - posePosition.x,
            host.position.y - posePosition.y,
            host.position.z - posePosition.z,
          );
        return (
          Math.hypot(
            host.linearVelocity.x,
            host.linearVelocity.y,
            host.linearVelocity.z,
          ) < 0.02 &&
          Math.hypot(
            local.linearVelocity.x,
            local.linearVelocity.y,
            local.linearVelocity.z,
          ) < 0.02 &&
          error(local.position) < 0.01 &&
          error(rendered.position) < 0.01
        );
      },
      targetId,
      { timeout: 5_000 },
    );
    console.log(
      `pickup ${profile}: ${samples.length} release frames, ${(maximumFrameStep * 100).toFixed(2)}cm maximum step`,
    );
    await assertNoDiscardedWorkerTime(page);
  } finally {
    await page.close();
  }
}

async function contentionAndRecovery(
  firstBrowser: Browser,
  secondBrowser: Browser,
): Promise<void> {
  const first = await openPage(firstBrowser, TYPICAL_IMPAIRMENT);
  const second = await openPage(secondBrowser, {
    ...ADVERSE_IMPAIRMENT,
    seed: ADVERSE_IMPAIRMENT.seed + 1,
  });
  try {
    await Promise.all([
      first.waitForFunction(() =>
        Boolean(
          document.querySelector<HTMLElement>("#gurgur-root")!.dataset
            .interactionTarget,
        ),
      ),
      second.waitForFunction(() =>
        Boolean(
          document.querySelector<HTMLElement>("#gurgur-root")!.dataset
            .interactionTarget,
        ),
      ),
    ]);
    const targetId = await first.evaluate(
      () =>
        document.querySelector<HTMLElement>("#gurgur-root")!.dataset
          .interactionTarget!,
    );
    const secondTargetId = await second.evaluate(
      () =>
        document.querySelector<HTMLElement>("#gurgur-root")!.dataset
          .interactionTarget!,
    );
    if (secondTargetId !== targetId)
      throw new Error(
        `contention selected different targets (${targetId}, ${secondTargetId})`,
      );
    await Promise.all([pressPrimary(first), pressPrimary(second)]);
    const holder = await Promise.race([
      first
        .waitForFunction(
          (target) =>
            (window as unknown as SmokeWindow).__gurgurDiagnostics.clientFeel()
              .prediction.held === target,
          targetId,
        )
        .then(() => first),
      second
        .waitForFunction(
          (target) =>
            (window as unknown as SmokeWindow).__gurgurDiagnostics.clientFeel()
              .prediction.held === target,
          targetId,
        )
        .then(() => second),
    ]);
    const observer = holder === first ? second : first;
    await observer.waitForFunction(
      (target) =>
        (window as unknown as SmokeWindow).__gurgurDiagnostics.clientFeel()
          .prediction.held !== target,
      targetId,
    );
    for (const page of [holder, observer]) {
      const authority = await page.evaluate((target) => {
        const entity = (window as unknown as SmokeWindow).__gurgurDiagnostics
          .network()
          .entities.find(
            (candidate) =>
              `${candidate.id.index}:${candidate.id.generation}` === target,
          );
        return entity
          ? {
              ownerPlayerId: entity.ownerPlayerId,
              transferPolicy: entity.transferPolicy,
            }
          : null;
      }, targetId);
      if (
        !authority ||
        authority.ownerPlayerId !== null ||
        authority.transferPolicy !== "fixed"
      )
        throw new Error(
          `contention changed prop authority: ${JSON.stringify(authority)}`,
        );
    }
    await holder.close();
    await observer.waitForFunction(
      (target) =>
        document.querySelector<HTMLElement>("#gurgur-root")!.dataset
          .interactionTarget === target &&
        document.querySelector<HTMLElement>("#gurgur-root")!.dataset
          .interactionOutline !== "held",
      targetId,
    );

    const reconnectPlayer = await localPlayerKey(observer);
    const reconnectVersion = await authorityVersion(observer, reconnectPlayer);
    await observer.reload();
    await observer
      .locator('#gurgur-root[data-owner-physics="ready"]')
      .waitFor({ timeout: 15_000 });
    await observer
      .locator('#gurgur-root[data-input-ready="true"]')
      .waitFor({ timeout: 15_000 });
    await observer
      .locator('#gurgur-root[data-player-view-ready="true"]')
      .waitFor({ timeout: 15_000 });
    const resumedPlayer = await localPlayerKey(observer);
    if (resumedPlayer !== reconnectPlayer)
      throw new Error(
        `reconnect changed player identity (${reconnectPlayer} -> ${resumedPlayer})`,
      );
    await observer.waitForFunction(
      ({ id, version }) => {
        const entity = (window as unknown as SmokeWindow).__gurgurDiagnostics
          .network()
          .entities.find(
            (candidate) =>
              `${candidate.id.index}:${candidate.id.generation}` === id,
          );
        return entity !== undefined && entity.authorityVersion > version;
      },
      { id: reconnectPlayer, version: reconnectVersion },
    );

    const epoch = await observer.evaluate(
      () =>
        (window as unknown as SmokeWindow).__gurgurDiagnostics.network()
          .worldEpoch,
    );
    if (epoch === null)
      throw new Error("browser reset has no current world epoch");
    const response = await fetch(
      `http://127.0.0.1:${server.port}/admin/reset`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${adminToken}` },
      },
    );
    if (!response.ok)
      throw new Error(`connected reset failed (${response.status})`);
    await observer.waitForFunction(
      (previous) =>
        (window as unknown as SmokeWindow).__gurgurDiagnostics.network()
          .worldEpoch ===
          previous + 1 &&
        document.querySelector<HTMLElement>("#gurgur-root")!.dataset
          .ownerPhysics === "ready" &&
        document.querySelector<HTMLElement>("#gurgur-root")!.dataset
          .inputReady === "true",
      epoch,
    );
    await assertNoDiscardedWorkerTime(observer);
  } finally {
    if (!first.isClosed()) await first.close();
    if (!second.isClosed()) await second.close();
  }
}

async function contraptionInteraction(browser: Browser): Promise<void> {
  const fixturePath = "content/maps/fixtures/physics-contraptions.map";
  const contraptionBundle = compileWorld(
    await Bun.file(fixturePath).text(),
    fixturePath,
  );
  const lever = contraptionBundle.entities.find(
    (entity) =>
      entity.kind === "physics-prop" &&
      entity.authoredId === "fixture.lever.body",
  );
  if (!lever || lever.kind !== "physics-prop")
    throw new Error("browser contraption fixture is unavailable");
  const leverBrush = contraptionBundle.brushes[lever.body.brushIndices[1]!]!;
  const contraptionDirectory = await mkdtemp(
    join(tmpdir(), "gurgur-browser-contraption-"),
  );
  const contraptionServer = await createGurgurServer({
    port: 0,
    hostname: "127.0.0.1",
    databasePath: join(contraptionDirectory, "world.sqlite"),
    worldBundle: contraptionBundle,
    playerSpawn: {
      x: leverBrush.center.x,
      y: PLAYER_HALF_HEIGHT + 0.4064,
      z: leverBrush.center.z + 1.8,
    },
  });
  const page = await openPage(
    browser,
    ADVERSE_IMPAIRMENT,
    contraptionServer.port,
  );
  try {
    await page.waitForFunction(
      () =>
        Number(
          document.querySelector<HTMLElement>("#gurgur-root")!.dataset
            .constraintVisuals,
        ) >= 8,
    );
    await page.waitForFunction(() =>
      Boolean(
        document.querySelector<HTMLElement>("#gurgur-root")!.dataset
          .interactionTarget,
      ),
    );
    const targetId = await page.evaluate(
      () =>
        document.querySelector<HTMLElement>("#gurgur-root")!.dataset
          .interactionTarget!,
    );
    const initialRotation = await page.evaluate((target) => {
      const state = (window as unknown as SmokeWindow).__gurgurDiagnostics
        .presentation()
        .find((candidate) => candidate.runtimeId === target);
      if (!state) throw new Error("lever presentation is unavailable");
      return state.rotation;
    }, targetId);
    await pressPrimary(page);
    await page.waitForFunction(
      (target) =>
        document.querySelector<HTMLElement>("#gurgur-root")!.dataset
          .manipulationTarget === target &&
        document.querySelector<HTMLElement>("#gurgur-root")!.dataset
          .interactionOutline === "held",
      targetId,
    );
    const descriptorOwner = await page.evaluate((target) => {
      const entity = (window as unknown as SmokeWindow).__gurgurDiagnostics
        .network()
        .entities.find(
          (candidate) =>
            `${candidate.id.index}:${candidate.id.generation}` === target,
        );
      if (!entity)
        throw new Error("manipulated entity descriptor is unavailable");
      return entity.ownerPlayerId;
    }, targetId);
    if (descriptorOwner !== null)
      throw new Error(
        "fixed contraption manipulation transferred network ownership",
      );
    await turnTouch(page, 220);
    try {
      await page.waitForFunction(
        ({ target, initial }) => {
          const state = (window as unknown as SmokeWindow).__gurgurDiagnostics
            .presentation()
            .find((candidate) => candidate.runtimeId === target);
          return (
            state !== undefined &&
            Math.hypot(
              state.rotation.x - initial.x,
              state.rotation.y - initial.y,
              state.rotation.z - initial.z,
              state.rotation.w - initial.w,
            ) > 0.005
          );
        },
        { target: targetId, initial: initialRotation },
        { timeout: 5_000 },
      );
    } catch {
      const diagnostics = await page.evaluate(
        (target) => ({
          manipulationTarget:
            document.querySelector<HTMLElement>("#gurgur-root")!.dataset
              .manipulationTarget,
          manipulationStateAt:
            document.querySelector<HTMLElement>("#gurgur-root")!.dataset
              .manipulationStateAt,
          manipulationStateCount:
            document.querySelector<HTMLElement>("#gurgur-root")!.dataset
              .manipulationStateCount,
          manipulationStateSent:
            document.querySelector<HTMLElement>("#gurgur-root")!.dataset
              .manipulationStateSent,
          manipulationState:
            document.querySelector<HTMLElement>("#gurgur-root")!.dataset
              .manipulationState,
          outline:
            document.querySelector<HTMLElement>("#gurgur-root")!.dataset
              .interactionOutline,
          state: (window as unknown as SmokeWindow).__gurgurDiagnostics
            .presentation()
            .find((candidate) => candidate.runtimeId === target),
        }),
        targetId,
      );
      throw new Error(
        `browser contraption did not move: ${JSON.stringify(diagnostics)}`,
      );
    }
    await pressPrimary(page);
    await page.waitForFunction(
      () =>
        document.querySelector<HTMLElement>("#gurgur-root")!.dataset
          .manipulationTarget === "" &&
        document.querySelector<HTMLElement>("#gurgur-root")!.dataset
          .interactionOutline !== "held",
    );
    await assertNoDiscardedWorkerTime(page);
  } finally {
    await page.close();
    contraptionServer.stop();
    await rm(contraptionDirectory, { recursive: true, force: true });
  }
}

async function debugPhysicsCapture(browser: Browser): Promise<void> {
  const page = await openPage(browser, LOCAL_IMPAIRMENT, server.port, true);
  try {
    const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
    await page.getByRole("button", { name: "record 15s" }).click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    if (!downloadPath)
      throw new Error("debug physics capture download has no local path");
    const bytes = await readFile(downloadPath);
    const json = download.suggestedFilename().endsWith(".gz")
      ? gunzipSync(bytes)
      : bytes;
    const artifact = JSON.parse(json.toString()) as {
      format?: unknown;
      version?: unknown;
      client?: { frames?: unknown[] };
      server?: { frames?: unknown[]; complete?: unknown };
    };
    const clientFrames = artifact.client?.frames?.length ?? 0;
    const serverFrames = artifact.server?.frames?.length ?? 0;
    if (
      artifact.format !== "gurgur-networked-physics-capture" ||
      artifact.version !== 1 ||
      clientFrames < 800 ||
      serverFrames !== 900 ||
      artifact.server?.complete !== true
    )
      throw new Error(
        `debug physics capture is incomplete: ${JSON.stringify({ clientFrames, serverFrames, complete: artifact.server?.complete })}`,
      );
    await assertNoDiscardedWorkerTime(page);
  } finally {
    await page.close();
  }
}

async function openPage(
  browser: Browser,
  impairment: BrowserImpairment,
  port = server.port,
  debug = false,
): Promise<Page> {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().startsWith("Failed to load resource")
    )
      errors.push(message.text());
  });
  await page.addInitScript(() => {
    const pad = {
      connected: true,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 8 }, () => ({ pressed: false, value: 0 })),
    };
    Object.defineProperty(window, "__gurgurSmokePad", { value: pad });
    Object.defineProperty(navigator, "getGamepads", { value: () => [pad] });
  });
  const url = new URL(`http://127.0.0.1:${port}/`);
  url.searchParams.set("test", "1");
  if (debug) url.searchParams.set("debug", "1");
  url.searchParams.set(
    "simulatedLatencyMs",
    String(impairment.oneWayLatencyMs),
  );
  url.searchParams.set("simulatedJitterMs", String(impairment.jitterMs));
  url.searchParams.set("simulatedLossRate", String(impairment.lossRate));
  url.searchParams.set("simulatedSeed", String(impairment.seed));
  await page.goto(url.href);
  await page
    .locator('#gurgur-root[data-owner-physics="ready"]')
    .waitFor({ timeout: 15_000 });
  await page
    .locator('#gurgur-root[data-input-ready="true"]')
    .waitFor({ timeout: 15_000 });
  await page
    .locator('#gurgur-root[data-player-view-ready="true"]')
    .waitFor({ timeout: 15_000 });
  if (errors.length > 0)
    throw new Error(`browser startup errors: ${errors.join("; ")}`);
  return page;
}

async function assertNoDiscardedWorkerTime(page: Page): Promise<void> {
  const discarded = await page.evaluate(
    () =>
      (window as unknown as SmokeWindow).__gurgurDiagnostics.physics()
        .discardedCatchUpSeconds,
  );
  if (discarded !== 0)
    throw new Error(
      `browser worker discarded ${discarded.toFixed(6)}s of fixed-step time`,
    );
}

async function proveMainThreadIsolation(page: Page): Promise<void> {
  const playerId = await localPlayerKey(page);
  const before = await page.evaluate(
    (id) =>
      (window as unknown as SmokeWindow).__gurgurDiagnostics
        .replication()
        .find((state) => state.runtimeId === id)?.stateSequence ?? -1,
    playerId,
  );
  await page.evaluate(() => {
    const until = performance.now() + 120;
    while (performance.now() < until) {
      // Deliberately block only the renderer main thread.
    }
  });
  await page.waitForFunction(
    ({ id, sequence }) =>
      ((window as unknown as SmokeWindow).__gurgurDiagnostics
        .replication()
        .find((state) => state.runtimeId === id)?.stateSequence ?? -1) !==
      sequence,
    { id: playerId, sequence: before },
  );
  await assertNoDiscardedWorkerTime(page);
}

async function proveWorkerStallAccounting(page: Page): Promise<void> {
  const playerId = await localPlayerKey(page);
  const before = await page.evaluate(
    (id) =>
      (window as unknown as SmokeWindow).__gurgurDiagnostics
        .replication()
        .find((state) => state.runtimeId === id)?.stateSequence ?? -1,
    playerId,
  );
  await page.evaluate(() =>
    (window as unknown as SmokeWindow).__gurgurDiagnostics.stallPhysicsWorker(
      120,
    ),
  );
  await page.waitForFunction(
    () =>
      (window as unknown as SmokeWindow).__gurgurDiagnostics.physics()
        .discardedCatchUpSeconds > 0,
  );
  await page.waitForFunction(
    ({ id, sequence }) =>
      ((window as unknown as SmokeWindow).__gurgurDiagnostics
        .replication()
        .find((state) => state.runtimeId === id)?.stateSequence ?? -1) !==
      sequence,
    { id: playerId, sequence: before },
  );
}

async function localPlayerKey(page: Page): Promise<string> {
  return page.evaluate(() => {
    const id = (window as unknown as SmokeWindow).__gurgurDiagnostics.network()
      .localPlayerId!;
    return `${id.index}:${id.generation}`;
  });
}

async function authorityVersion(page: Page, id: string): Promise<number> {
  return page.evaluate((runtimeId) => {
    const entity = (window as unknown as SmokeWindow).__gurgurDiagnostics
      .network()
      .entities.find(
        (candidate) =>
          `${candidate.id.index}:${candidate.id.generation}` === runtimeId,
      );
    if (!entity) throw new Error(`missing network entity ${runtimeId}`);
    return entity.authorityVersion;
  }, id);
}

async function position(page: Page, id: string) {
  return page.evaluate((runtimeId) => {
    const state = (window as unknown as SmokeWindow).__gurgurDiagnostics
      .presentation()
      .find((candidate) => candidate.runtimeId === runtimeId);
    if (!state) throw new Error(`missing presentation state ${runtimeId}`);
    return state.position;
  }, id);
}

async function tracePositions(
  page: Page,
  id: string,
  durationMs: number,
): Promise<Array<{ x: number; y: number; z: number }>> {
  return page.evaluate(
    ({ runtimeId, duration }) =>
      new Promise<Array<{ x: number; y: number; z: number }>>((resolve) => {
        const samples: Array<{ x: number; y: number; z: number }> = [];
        const startedAt = performance.now();
        const sample = (now: number): void => {
          const state = (window as unknown as SmokeWindow).__gurgurDiagnostics
            .presentation()
            .find((candidate) => candidate.runtimeId === runtimeId);
          if (state) samples.push({ ...state.position });
          if (now - startedAt >= duration) resolve(samples);
          else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }),
    { runtimeId: id, duration: durationMs },
  );
}

function maximumStep(
  samples: Array<{ x: number; y: number; z: number }>,
): number {
  return samples.slice(1).reduce((maximum, sample, index) => {
    const previous = samples[index]!;
    return Math.max(
      maximum,
      Math.hypot(
        sample.x - previous.x,
        sample.y - previous.y,
        sample.z - previous.z,
      ),
    );
  }, 0);
}

async function pressPrimary(page: Page): Promise<void> {
  await page.evaluate(() => {
    const pad = (window as unknown as SmokeWindow).__gurgurSmokePad;
    pad.buttons[7]!.pressed = true;
  });
  await page.waitForTimeout(40);
  await page.evaluate(() => {
    const pad = (window as unknown as SmokeWindow).__gurgurSmokePad;
    pad.buttons[7]!.pressed = false;
  });
  await page.waitForTimeout(40);
}

async function turnTouch(page: Page, pixels: number): Promise<void> {
  await page.dispatchEvent("canvas", "pointerdown", {
    pointerId: 77,
    pointerType: "touch",
    clientX: 960,
    clientY: 360,
  });
  await page.dispatchEvent("canvas", "pointermove", {
    pointerId: 77,
    pointerType: "touch",
    clientX: 960 + pixels,
    clientY: 360,
  });
  await page.dispatchEvent("canvas", "pointerup", {
    pointerId: 77,
    pointerType: "touch",
    clientX: 960 + pixels,
    clientY: 360,
  });
}

type DiagnosticRuntime = {
  id: { index: number; generation: number };
  ownerPlayerId: { index: number; generation: number } | null;
  authorityVersion: number;
  transferPolicy: "fixed";
};
type SmokeWindow = {
  __gurgurSmokePad: {
    axes: number[];
    buttons: Array<{ pressed: boolean; value: number }>;
  };
  __gurgurDiagnostics: {
    clientFeel(): {
      presentation: {
        networkDelayPolicy: "adaptive-render";
        minimumNetworkDelayTicks: number;
        networkDelayTicks: number;
        desiredNetworkDelayTicks: number;
        underrunSamples: number;
        trackDelayTicks: Record<string, number>;
      };
      prediction: {
        held: string | null;
      };
    };
    presentation(): Array<{
      runtimeId: string;
      position: { x: number; y: number; z: number };
      rotation: { x: number; y: number; z: number; w: number };
    }>;
    network(): {
      worldEpoch: number | null;
      localPlayerId: { index: number; generation: number } | null;
      entities: DiagnosticRuntime[];
    };
    replication(): Array<{
      runtimeId: string;
      count: number;
      stateSequence: number;
      receivedAtMs: number;
      position: { x: number; y: number; z: number };
    }>;
    physics(): {
      discardedCatchUpSeconds: number;
    };
    predictionTrace(): PredictionTraceFrame[];
    stallPhysicsWorker(durationMs: number): void;
  };
};
