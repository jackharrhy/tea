import { expect, test } from "bun:test";
import { parseClientMessage } from "@tea/pool-protocol";
import { ClientTelemetry } from "../../app/game/client-telemetry";

test("baseline, jitter and submillimeter noise do not report", () => {
  const metrics = new ClientTelemetry(0);
  for (let now = 0; now < 10000; now += 33) {
    metrics.packet(now);
    metrics.correction("movement", null, null, 1e-8);
  }
  expect(metrics.flush(10000)).toEqual([]);
});

test("bounded histogram emits only at window boundaries and validates on wire", () => {
  const metrics = new ClientTelemetry(0);
  metrics.packet(0);
  metrics.packet(150);
  for (const error of [0.01, 0.05, 0.2, 200])
    metrics.correction("pool", "a", 2, error);
  expect(metrics.flush(9999)).toEqual([]);
  const reports = metrics.flush(10000);
  expect(reports).toEqual([
    {
      type: "diagnostic",
      kind: "pool",
      table: "a",
      turn: 2,
      durationMs: 10000,
      count: 4,
      maxError: 100,
      errorBins: [1, 1, 1, 1],
      maxPacketGapMs: 150,
    },
  ]);
  expect(parseClientMessage(JSON.stringify(reports[0]))).toEqual(reports[0]);
  expect(metrics.flush(20000)).toEqual([]);
});

test("frequent small corrections report and completed meaningful shots survive", () => {
  const metrics = new ClientTelemetry(0);
  metrics.correction("pool", "a", 0, 1);
  metrics.correction("pool", "a", 1, 0.01);
  expect(metrics.flush(10000)).toEqual([
    expect.objectContaining({ turn: 0, maxError: 1 }),
  ]);
  for (let i = 0; i < 70000; i++)
    metrics.correction("movement", null, null, 0.01);
  const report = metrics.flush(20000)[0]!;
  expect(report.count).toBe(65535);
  expect(report.errorBins).toEqual([65535, 0, 0, 0]);
});

test("flush retains correction-time command context across turn changes", () => {
  const metrics = new ClientTelemetry(0);
  metrics.context("a", 1);
  metrics.correction("pool", "a", 7, 0.2);
  // Later snapshots may have advanced the turn; rack and table are unchanged.
  metrics.context("a", 1);
  expect(metrics.flush(10000)[0]).toMatchObject({
    table: "a",
    turn: 7,
    count: 1,
  });
});

test("rematch, table departure and disappearance discard stale pool windows", () => {
  for (const next of [
    { table: "a", rack: 2 },
    { table: "b", rack: 1 },
    { table: null, rack: null },
    { table: "a", rack: null },
  ]) {
    const metrics = new ClientTelemetry(0);
    metrics.context("a", 1);
    metrics.correction("pool", "a", 0, 0.5);
    metrics.correction("pool", "a", 1, 0.2);
    metrics.context(next.table, next.rack);
    expect(metrics.flush(10000)).toEqual([]);
  }
});

test("a rematch reusing turn zero keeps only the new game's correction", () => {
  const metrics = new ClientTelemetry(0);
  metrics.context("a", 1);
  metrics.correction("pool", "a", 0, 2);
  metrics.context("a", 2);
  metrics.correction("pool", "a", 0, 0.2);
  expect(metrics.flush(10000)[0]).toMatchObject({
    turn: 0,
    count: 1,
    maxError: 0.2,
  });
});

test("shot N survives shot N+1 before the flush, preserving both contexts", () => {
  const metrics = new ClientTelemetry(0);
  metrics.context("a", 1);
  metrics.correction("pool", "a", 7, 2);
  metrics.correction("pool", "a", 8, 0.2);
  expect(metrics.flush(9999)).toEqual([]);
  const reports = metrics.flush(10000);
  expect(
    reports.map(({ table, turn, maxError }) => ({ table, turn, maxError })),
  ).toEqual([
    { table: "a", turn: 7, maxError: 2 },
    { table: "a", turn: 8, maxError: 0.2 },
  ]);
  expect(metrics.flush(20000)).toEqual([]);
});

test("pending queue retains eight worst completed shots; flush orders all kinds by error", () => {
  const metrics = new ClientTelemetry(0);
  metrics.context("a", 1);
  // The oldest shot is the worst; retaining only the newest eight would lose it.
  for (let turn = 0; turn < 20; turn++)
    metrics.correction("pool", "a", turn, 20 - turn);
  metrics.correction("movement", null, null, 30);
  const first = metrics.flush(10000);
  expect(first).toHaveLength(4);
  expect(metrics.flush(10000)).toEqual([]);
  expect(metrics.flush(19999)).toEqual([]);
  const second = metrics.flush(20000);
  expect(second).toHaveLength(4);
  const third = metrics.flush(30000);
  const reports = [...first, ...second, ...third];
  expect(reports.map((report) => report.maxError)).toEqual([
    30, 20, 19, 18, 17, 16, 15, 14, 13, 1,
  ]);
  expect(
    reports
      .filter((report) => report.kind === "pool")
      .map((report) => report.turn),
  ).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 19]);
  for (const report of reports)
    expect(parseClientMessage(JSON.stringify(report))).toEqual(report);
});

test("single 7.5 cm pool correction reports while movement requires 10 cm", () => {
  const metrics = new ClientTelemetry(0);
  metrics.context("a", 1);
  metrics.correction("pool", "a", 7, 0.075);
  metrics.correction("movement", null, null, 0.075);
  // Transition before flush also exercises the completed-window threshold.
  metrics.correction("pool", "a", 8, 0.075);
  const reports = metrics.flush(10000);
  expect(reports).toHaveLength(2);
  expect(
    reports.map(({ kind, turn, maxError, errorBins }) => ({
      kind,
      turn,
      maxError,
      errorBins,
    })),
  ).toEqual([
    { kind: "pool", turn: 7, maxError: 0.075, errorBins: [0, 1, 0, 0] },
    { kind: "pool", turn: 8, maxError: 0.075, errorBins: [0, 1, 0, 0] },
  ]);
});

test("unsent windows compete with fresh reports under the shared four-report budget", () => {
  const metrics = new ClientTelemetry(0);
  metrics.context("a", 1);
  for (let turn = 0; turn < 10; turn++)
    metrics.correction("pool", "a", turn, turn + 1);
  expect(metrics.flush(10000).map((report) => report.maxError)).toEqual([
    10, 9, 8, 7,
  ]);
  metrics.correction("movement", null, null, 20);
  metrics.correction("pool", "a", 10, 15);
  expect(metrics.flush(15000)).toEqual([]);
  expect(metrics.flush(20000).map((report) => report.maxError)).toEqual([
    20, 15, 6, 5,
  ]);
  const rest = metrics.flush(30000);
  expect(rest.map((report) => report.maxError)).toEqual([4, 3, 2]);
  expect(rest.every((report) => report.durationMs === 10000)).toBe(true);
});
