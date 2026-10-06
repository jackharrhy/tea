import test from "node:test";
import assert from "node:assert/strict";
import { JobManager } from "../../app/execution/job-manager.ts";
import { SystemdRunner } from "../../app/systemd-runner.ts";
const enabled = process.env.NEWPORT_REAL_TEST === "1";
async function done(jobs: JobManager, id: string) {
  for (let i = 0; i < 200; i++) {
    const j = jobs.readJob("fixture", id);
    if (!["running", "cancelling"].includes(j.status)) return j;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("cleanup not confirmed");
}
test(
  "real UID, multiple cwd, stderr and exit status",
  { skip: !enabled },
  async () => {
    const jobs = new JobManager({
      runner: new SystemdRunner("/usr/local/libexec/newport-shell-job"),
    });
    for (const cwd of ["/home/newport-exec", "/usr"]) {
      const { job } = jobs.execute("fixture", {
        command: "pwd; id -un; printf fixture-error >&2; exit 7",
        cwd,
        idempotencyKey: cwd.replaceAll("/", "_"),
      });
      const result = await done(jobs, job.jobId);
      assert.equal(result.exitCode, 7);
      assert.equal(result.stdout, `${cwd}\nnewport-exec\n`);
      assert.equal(result.stderr, "fixture-error");
    }
  },
);
test(
  "real jobs cannot read host-mounted LAN storage",
  { skip: !enabled },
  async () => {
    const jobs = new JobManager({
      runner: new SystemdRunner("/usr/local/libexec/newport-shell-job"),
    });
    const { job } = jobs.execute("fixture", {
      command: "test ! -r /mnt/stash/newport",
      idempotencyKey: "nfs-denied",
    });
    assert.equal((await done(jobs, job.jobId)).exitCode, 0);
  },
);
test(
  "real jobs deny private, local and hairpin egress",
  { skip: !enabled },
  async () => {
    const jobs = new JobManager({
      runner: new SystemdRunner("/usr/local/libexec/newport-shell-job"),
    });
    const code = `import socket, errno
for address in ['127.0.0.1','10.0.0.80','100.123.66.70','169.254.169.254','172.17.0.1','192.168.1.1','173.35.51.79','::1','fd7a:115c:a1e0::42fb:4246','2607:fea8:ff01:7bb8::774f']:
 s=socket.socket(socket.AF_INET6 if ':' in address else socket.AF_INET,socket.SOCK_DGRAM)
 try:
  s.sendto(b'fixture',(address,9))
 except OSError as e:
  assert e.errno in (errno.EPERM, errno.EACCES), (address,e)
 else:
  raise AssertionError('egress not denied: '+address)
 finally:
  s.close()
print('network-denied')`;
    const { job } = jobs.execute("fixture", {
      command: `python3 -c "import base64; exec(base64.b64decode('${Buffer.from(code).toString("base64")}'))"`,
      idempotencyKey: "network-denied",
    });
    const result = await done(jobs, job.jobId);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "network-denied\n");
  },
);
test(
  "real descendant cleanup, cancellation, timeout and bounded flood",
  { skip: !enabled },
  async () => {
    const jobs = new JobManager({
      runner: new SystemdRunner("/usr/local/libexec/newport-shell-job"),
      maxOutputBytes: 1000,
    });
    let { job } = jobs.execute("fixture", {
      command: "yes fixture | head -c 100000",
      idempotencyKey: "flood",
    });
    let result = await done(jobs, job.jobId);
    assert.equal(result.exitCode, 0);
    assert.equal(result.output.retainedBytes, 1000);
    assert.equal(result.output.truncated, true);
    ({ job } = jobs.execute("fixture", {
      command: 'setsid sh -c "sleep 120" & echo child-started; wait',
      idempotencyKey: "cancel",
    }));
    await new Promise((r) => setTimeout(r, 400));
    jobs.cancel("fixture", job.jobId);
    result = await done(jobs, job.jobId);
    assert.equal(result.status, "cancelled");
    ({ job } = jobs.execute("fixture", {
      command: "sleep 120",
      idempotencyKey: "timeout",
      timeoutMs: 500,
    }));
    result = await done(jobs, job.jobId);
    assert.equal(result.status, "timed_out");
  },
);
