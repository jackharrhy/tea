import test from "node:test";
import assert from "node:assert/strict";
import { JobManager } from "../../app/execution/job-manager.ts";
import { SystemdRunner } from "../../app/systemd-runner.ts";
const enabled = process.env.NEWPORT_REAL_TEST === "1";
async function run(command: string, timeoutMs = 20000) {
  const jobs = new JobManager({
    runner: new SystemdRunner("/usr/local/libexec/newport-shell-job"),
  });
  const { job } = jobs.execute("fixture", {
    command,
    timeoutMs,
    idempotencyKey: "security",
  });
  for (let i = 0; i < 700; i++) {
    const result = jobs.readJob("fixture", job.jobId);
    if (!["running", "cancelling"].includes(result.status)) return result;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("job cleanup unconfirmed");
}
function python(code: string) {
  return `python3 -c "import base64; exec(base64.b64decode('${Buffer.from(code).toString("base64")}'))"`;
}
test(
  "real aggregate allocation quota on both local writable filesystems",
  { skip: !enabled },
  async () => {
    const r = await run(
      python(`import os, tempfile, errno, shutil
for base in ['/home/newport-exec','/mnt/terrabud/newport-shell-quota-fixture']:
 directory=tempfile.mkdtemp(dir=base)
 try:
  denied=False
  for i in range(20):
   try:
    with open(directory+'/'+str(i),'wb') as f: os.posix_fallocate(f.fileno(),0,128*1024*1024)
   except OSError as e:
    assert e.errno==errno.EDQUOT, str(e)
    denied=True
    break
  assert denied, 'aggregate quota not enforced'
 finally: shutil.rmtree(directory)
print('quota-enforced')`),
    );
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(r.stdout, "quota-enforced\n");
  },
);
test(
  "real secret, proc, sudo, docker and namespace denials",
  { skip: !enabled },
  async () => {
    const r = await run(
      python(`import os, socket, subprocess
for path in ['/etc/newport-shell/security-sentinel','/var/lib/newport-shell/security-sentinel','/opt/newport-shell/server.ts','/proc/1/environ']:
 try: open(path).read()
 except (PermissionError,FileNotFoundError): pass
 else: raise AssertionError('readable: '+path)
for command in [['sudo','-n','/usr/local/libexec/newport-shell-job'],['sudo','-n','true'],['unshare','-Ur','true']]:
 assert subprocess.run(command,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode!=0
try: socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
except OSError: pass
else: raise AssertionError('AF_UNIX allowed')
assert os.getgroups()==[os.getgid()], os.getgroups()
print('separation-enforced')`),
    );
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(r.stdout, "separation-enforced\n");
  },
);
test("real cgroup PID and memory ceilings", { skip: !enabled }, async () => {
  let r = await run(
    python(`import os, errno, time
children=[]
try:
 for i in range(150):
  try: pid=os.fork()
  except OSError as e:
   assert e.errno==errno.EAGAIN
   print('pids-enforced',flush=True)
   break
  if pid==0:
   time.sleep(20)
   os._exit(0)
  children.append(pid)
 else: raise AssertionError('PID ceiling missing')
finally:
 for pid in children:
  try: os.kill(pid,9)
  except ProcessLookupError: pass
 for pid in children: os.waitpid(pid,0)`),
  );
  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(r.stdout, "pids-enforced\n");
  r = await run(
    python(`a=[]
for i in range(24): a.append(bytearray(64*1024*1024))
print('MEMORY_LIMIT_MISSING')`),
  );
  assert.notEqual(r.exitCode, 0);
  assert.doesNotMatch(r.stdout, /MEMORY_LIMIT_MISSING/);
  assert.equal(r.status, "failed");
});
test(
  "real two-slot capacity and double-fork cleanup",
  { skip: !enabled },
  async () => {
    const jobs = new JobManager({
      runner: new SystemdRunner("/usr/local/libexec/newport-shell-job"),
    });
    const command = python(`import os,time
if os.fork()==0:
 os.setsid()
 if os.fork()==0: time.sleep(60)
 os._exit(0)
print('double-forked',flush=True)
time.sleep(60)`);
    const first = jobs.execute("fixture", { command, idempotencyKey: "first" });
    const second = jobs.execute("fixture", {
      command: "sleep 60",
      idempotencyKey: "second",
    });
    assert.throws(() =>
      jobs.execute("fixture", { command: "true", idempotencyKey: "third" }),
    );
    await new Promise((r) => setTimeout(r, 500));
    jobs.cancel("fixture", first.job.jobId);
    jobs.cancel("fixture", second.job.jobId);
    for (let i = 0; i < 100; i++) {
      if (
        [first, second].every(
          (j) => jobs.readJob("fixture", j.job.jobId).status === "cancelled",
        )
      )
        return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("cancellation not acknowledged");
  },
);
test("real public developer HTTPS and DNS", { skip: !enabled }, async () => {
  const r = await run(
    "curl --max-time 12 -fsS -o /dev/null https://registry.npmjs.org/typescript && curl -6 --max-time 12 -fsS -o /dev/null https://registry.npmjs.org/typescript && curl --max-time 12 -fsS -o /dev/null https://pypi.org/simple/pip/ && git ls-remote https://github.com/octocat/Hello-World.git HEAD",
    30000,
  );
  assert.equal(r.exitCode, 0, r.stderr);
  assert.match(r.stdout, /HEAD/);
});
