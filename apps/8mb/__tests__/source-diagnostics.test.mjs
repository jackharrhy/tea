import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createDiagnostics,
  validateDiagnostic,
} from "../app/ui/public/diagnostics.mjs";

function fixture() {
  const requests = [];
  let reads = 0;
  let agentReads = 0;
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const diagnostics = createDiagnostics({
    storage,
    context: () => {
      reads++;
      return {
        bytes: 70e9,
        duration: 7200,
        height: 1080,
        container: "mkv",
        videoCodec: "avc",
        audioCodec: "aac",
        filename: "private-recording.mp4",
        path: "C:\\Private\\recording.mp4",
      };
    },
    agent: () => {
      agentReads++;
      return "Mozilla/5.0 (Windows NT 10.0) Chrome/142.0 Edg/142.0";
    },
    request: (url, options) => {
      requests.push({ url, options });
      return Promise.resolve(new Response(null, { status: 204 }));
    },
  });
  return {
    diagnostics,
    requests,
    reads: () => reads,
    agentReads: () => agentReads,
  };
}

test("diagnostics do not read context or send before explicit consent", () => {
  const f = fixture();
  f.diagnostics.report({
    stage: "inspect",
    outcome: "failed",
    reason: "unreadable-input",
  });
  assert.equal(f.reads(), 0);
  assert.equal(f.agentReads(), 0);
  assert.deepEqual(f.requests, []);
  assert.equal(f.diagnostics.enabled, false);
});

test("consented diagnostics send only coarse allowlisted data without cookies/referrers", async () => {
  const f = fixture();
  f.diagnostics.setEnabled(true);
  assert.deepEqual(f.requests, [], "consent does not upload earlier errors");
  f.diagnostics.report({
    stage: "inspect",
    outcome: "failed",
    reason: "unreadable-input",
  });
  assert.equal(f.requests.length, 1);
  const { url, options } = f.requests[0];
  assert.equal(url, "/8mb/api/diagnostics");
  assert.equal(options.credentials, "omit");
  assert.equal(options.referrerPolicy, "no-referrer");
  const event = JSON.parse(options.body);
  assert.equal(validateDiagnostic(event), true);
  assert.equal(event.input, "64g-plus");
  assert.equal(event.browser, "edge");
  assert.equal("browserMajor" in event, false);
  assert.equal(event.os, "windows");
  assert.doesNotMatch(
    options.body,
    /private|recording|Mozilla|7200|70000000000/i,
  );
  assert.equal(
    validateDiagnostic({ ...event, filename: "private.mp4" }),
    false,
  );
  assert.equal(
    validateDiagnostic({ ...event, reason: "arbitrary private text" }),
    false,
  );
  assert.equal(validateDiagnostic({ ...event, browserMajor: 142 }), false);
});

test("opt-out aborts pending sends and never queues a later replay", () => {
  const requests = [];
  const diagnostics = createDiagnostics({
    storage: {},
    context: () => ({}),
    agent: () => "",
    request: (url, options) => {
      requests.push(options);
      return new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      });
    },
  });
  diagnostics.setEnabled(true);
  diagnostics.report({ stage: "export", outcome: "succeeded", reason: "none" });
  diagnostics.report({
    stage: "export",
    outcome: "failed",
    reason: "unclassified",
  });
  assert.equal(requests.length, 1, "only one request may be pending; no queue");
  diagnostics.setEnabled(false);
  assert.equal(requests[0].signal.aborted, true);
  diagnostics.report({
    stage: "export",
    outcome: "failed",
    reason: "unclassified",
  });
  assert.equal(requests.length, 1);
});

test("blocked storage and broken context do not escape into editing", () => {
  const diagnostics = createDiagnostics({
    storage: {
      getItem() {
        throw new Error("denied");
      },
      setItem() {
        throw new Error("denied");
      },
    },
    context() {
      throw new Error("private path must stay local");
    },
    request() {
      throw new Error("offline");
    },
    agent: () => "",
  });
  diagnostics.setEnabled(true);
  assert.doesNotThrow(() =>
    diagnostics.report({
      stage: "export",
      outcome: "failed",
      reason: "unclassified",
    }),
  );
  diagnostics.setEnabled(false);
  assert.equal(diagnostics.enabled, false);
});

test("transport failures recover without retries, and reporting is capped per minute", async () => {
  let calls = 0,
    clock = 0;
  const diagnostics = createDiagnostics({
    storage: {},
    context: () => ({}),
    agent: () => "",
    now: () => clock,
    request: () => {
      calls++;
      return Promise.reject(new Error("offline"));
    },
  });
  diagnostics.setEnabled(true);
  for (let i = 0; i < 10; i++) {
    diagnostics.report({
      stage: "export",
      outcome: "failed",
      reason: "unclassified",
    });
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(calls, 6);
  clock = 60000;
  diagnostics.report({
    stage: "export",
    outcome: "failed",
    reason: "unclassified",
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 7);
});

test("read-only storage cannot silently restore consent after opt-out cannot persist", () => {
  const storage = {
    getItem: () => "true",
    setItem() {
      throw new Error("storage is read-only");
    },
    removeItem() {
      throw new Error("storage is read-only");
    },
  };
  const options = {
    storage,
    context: () => ({}),
    request: () => Promise.resolve(new Response()),
    agent: () => "",
  };
  const diagnostics = createDiagnostics(options);
  assert.equal(diagnostics.enabled, false);
  diagnostics.setEnabled(true);
  diagnostics.setEnabled(false);
  assert.equal(createDiagnostics(options).enabled, false);
});
