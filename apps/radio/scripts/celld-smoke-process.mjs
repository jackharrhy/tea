import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/** Owns only the isolated runtime process/container and its resource measurements. */
export class CelldSmokeProcess {
  logs = "";
  child;
  spawnError;
  memoryTimer;
  runtimePid;
  cgroup;
  container;
  memorySamples = [];
  sampledAt = 0;

  constructor({ root, state, environment, result, binary, image }) {
    Object.assign(this, { root, state, environment, result, binary, image });
  }

  async prepare() {
    if (this.image) {
      const inspected = JSON.parse(
        this.docker(["image", "inspect", this.image]),
      )[0];
      this.result.image = this.image;
      this.result.imageId = inspected.Id;
      this.image = inspected.Id;
      this.environment.CELLD_BIN = "/usr/local/bin/celld";
      this.result.version = this.docker([
        "run",
        "--rm",
        "--entrypoint",
        "/usr/local/bin/celld",
        this.image,
        "--version",
      ]).trim();
      this.result.binarySha256 = this.docker([
        "run",
        "--rm",
        "--entrypoint",
        "sha256sum",
        this.image,
        "/usr/local/bin/celld",
      ]).split(" ", 1)[0];
      return;
    }
    if (this.binary.includes("/")) {
      this.environment.CELLD_BIN = join(this.state, "celld");
      await copyFile(
        this.binary,
        this.environment.CELLD_BIN,
        constants.COPYFILE_FICLONE,
      );
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(this.environment.CELLD_BIN))
        hash.update(chunk);
      this.result.binarySha256 = hash.digest("hex");
    }
    this.result.binary = this.binary;
    this.result.version = this.command(this.environment.CELLD_BIN, [
      "--version",
    ]).trim();
  }

  async start(origin) {
    this.spawnError = undefined;
    this.runtimePid = undefined;
    this.cgroup = undefined;
    let executable = "sh";
    let args = [join(this.root, "scripts/start-celld.sh")];
    if (this.image) {
      executable = "docker";
      this.container = `radio-smoke-${process.pid}-${Date.now()}`;
      args = [
        "run",
        "--rm",
        "--name",
        this.container,
        "--network",
        "host",
        "--user",
        `${process.getuid()}:${process.getgid()}`,
        "--cpus",
        "1",
        "--memory",
        "1g",
        "--memory-swap",
        "1g",
        "--pids-limit",
        "256",
        "--mount",
        `type=bind,source=${this.state},target=${this.state}`,
      ];
      for (const key of Object.keys(this.environment)) {
        if (/^(CELLD_|AZURE_|AZURITE_|NODE_ENV$)/.test(key))
          args.push("--env", key);
      }
      args.push(this.image);
    }
    this.child = spawn(executable, args, {
      cwd: this.root,
      env: this.environment,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    this.child.once("error", (error) => {
      this.spawnError = error;
    });
    for (const stream of [this.child.stdout, this.child.stderr]) {
      stream.on("data", (chunk) => {
        this.logs += chunk.toString();
      });
    }
    if (!this.image) this.runtimePid = this.child.pid;
    clearInterval(this.memoryTimer);
    this.memoryTimer = setInterval(() => {
      void this.sampleMemory();
    }, 100);
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      if (this.spawnError) throw this.spawnError;
      if (this.child.exitCode !== null || this.child.signalCode !== null) {
        throw new Error(
          `Celld exited during startup:\n${this.logs.slice(-12000)}`,
        );
      }
      let ready = false;
      try {
        // Readiness attempts depend on the preceding result.
        // eslint-disable-next-line no-await-in-loop
        ready = (await fetch(origin, { signal: AbortSignal.timeout(2000) })).ok;
      } catch {}
      if (ready) {
        if (this.image) {
          const inspected = JSON.parse(
            this.docker(["inspect", this.container]),
          )[0];
          this.runtimePid = inspected.State.Pid;
          this.result.memoryLimitBytes = inspected.HostConfig.Memory;
          this.result.nanoCpus = inspected.HostConfig.NanoCpus;
          this.result.pidsLimit = inspected.HostConfig.PidsLimit;
          assert.equal(this.result.memoryLimitBytes, 1024 ** 3);
          assert.equal(this.result.nanoCpus, 1_000_000_000);
          assert.equal(this.result.pidsLimit, 256);
          // eslint-disable-next-line no-await-in-loop
          const groups = await readFile(
            `/proc/${this.runtimePid}/cgroup`,
            "utf8",
          );
          const path = groups.match(/^0::(.+)$/m)?.[1];
          if (path) {
            this.cgroup = join("/sys/fs/cgroup", path);
            // Verify the kernel limits as well as Docker's requested configuration.
            // eslint-disable-next-line no-await-in-loop
            const [memoryMax, swapMax, cpuMax, pidsMax] = await Promise.all([
              readFile(join(this.cgroup, "memory.max"), "utf8"),
              readFile(join(this.cgroup, "memory.swap.max"), "utf8"),
              readFile(join(this.cgroup, "cpu.max"), "utf8"),
              readFile(join(this.cgroup, "pids.max"), "utf8"),
            ]);
            assert.equal(Number(memoryMax), 1024 ** 3);
            assert.equal(Number(swapMax), 0);
            assert.equal(Number(pidsMax), 256);
            const [quota, period] = cpuMax.trim().split(" ").map(Number);
            assert.equal(quota / period, 1);
            this.result.kernelLimitsVerified = true;
          }
        }
        return;
      }
      // eslint-disable-next-line no-await-in-loop
      await delay(200);
    }
    throw new Error(`Celld did not become ready:\n${this.logs.slice(-12000)}`);
  }

  async stop(signal) {
    clearInterval(this.memoryTimer);
    await this.sampleMemory();
    const running =
      this.child &&
      !this.spawnError &&
      this.child.exitCode === null &&
      this.child.signalCode === null;
    if (signal === "SIGKILL")
      assert.ok(
        running,
        "The runtime must still be alive at the crash boundary",
      );
    if (!this.child?.pid || this.spawnError) return;
    const child = this.child;
    const killedPid = this.runtimePid;
    const kill = (requestedSignal) => {
      if (this.image) {
        this.docker(["kill", "--signal", requestedSignal, this.container]);
      } else {
        try {
          process.kill(-child.pid, requestedSignal);
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      }
    };
    if (!running) {
      if (this.image) this.removeContainer();
      else kill("SIGKILL");
      return;
    }
    const stopped = new Promise((resolve) =>
      child.once("exit", (code, exitSignal) =>
        resolve({ code, signal: exitSignal }),
      ),
    );
    kill(signal);
    let forcedError;
    const timer = setTimeout(() => {
      try {
        if (this.image) this.removeContainer();
        else kill("SIGKILL");
      } catch (error) {
        forcedError = error;
      }
    }, 15_000);
    let deadline;
    let exited;
    try {
      exited = await Promise.race([
        stopped,
        new Promise((_, reject) => {
          deadline = setTimeout(() => {
            child.kill("SIGTERM");
            reject(forcedError ?? new Error("Celld process cleanup timed out"));
          }, 60_000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      clearTimeout(deadline);
    }
    if (forcedError) throw forcedError;
    if (this.image) this.removeContainer();
    else kill("SIGKILL"); // Preparation may have descendants when the shell exits.
    if (signal === "SIGKILL") {
      if (this.image) assert.equal(exited.code, 137);
      else assert.equal(exited.signal, "SIGKILL");
      assert.throws(
        () => process.kill(killedPid, 0),
        { code: "ESRCH" },
        "The killed PID must be gone",
      );
      this.result.crash = {
        pid: killedPid,
        signal: "SIGKILL",
        exitCode: exited.code,
      };
    }
  }

  async sampleMemory() {
    if (process.platform !== "linux" || !this.runtimePid) return;
    try {
      const status = await readFile(`/proc/${this.runtimePid}/status`, "utf8");
      const highWaterKiB = Number(
        status.match(/^VmHWM:\s+(\d+) kB/m)?.[1] ?? 0,
      );
      const residentKiB = Number(status.match(/^VmRSS:\s+(\d+) kB/m)?.[1] ?? 0);
      this.result.runtimePeakRssBytes = Math.max(
        this.result.runtimePeakRssBytes ?? 0,
        highWaterKiB * 1024,
      );
      if (this.cgroup) {
        const peak = Number(
          await readFile(join(this.cgroup, "memory.peak"), "utf8"),
        );
        this.result.cgroupPeakBytes = Math.max(
          this.result.cgroupPeakBytes ?? 0,
          peak,
        );
        if (Date.now() - this.sampledAt >= 1000) {
          this.sampledAt = Date.now();
          const [current, stat, events, cpu] = await Promise.all([
            readFile(join(this.cgroup, "memory.current"), "utf8"),
            readFile(join(this.cgroup, "memory.stat"), "utf8"),
            readFile(join(this.cgroup, "memory.events"), "utf8"),
            readFile(join(this.cgroup, "cpu.stat"), "utf8"),
          ]);
          const sample = {
            at: new Date(this.sampledAt).toISOString(),
            pid: this.runtimePid,
            currentBytes: Number(current),
            rssBytes: residentKiB * 1024,
            stat: kernelCounters(stat),
            events: kernelCounters(events),
            cpu: kernelCounters(cpu),
          };
          this.memorySamples.push(sample);
          this.result.oomKills = Math.max(
            this.result.oomKills ?? 0,
            sample.events.oom_kill ?? 0,
          );
          if (
            sample.currentBytes >
            (this.result.highestObservedMemory?.currentBytes ?? 0)
          ) {
            this.result.highestObservedMemory = sample;
          }
        }
      }
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ESRCH")
        this.result.memorySamplingError = error.message;
    }
  }

  async saveTelemetry() {
    if (!this.memorySamples.length) return;
    this.result.memoryTelemetryPath = join(this.state, "memory-samples.json");
    await writeFile(
      this.result.memoryTelemetryPath,
      JSON.stringify(this.memorySamples, null, 2) + "\n",
    );
  }

  removeContainer() {
    const removed = spawnSync("docker", ["rm", "--force", this.container], {
      encoding: "utf8",
      timeout: 15_000,
      killSignal: "SIGKILL",
    });
    if (removed.error) throw removed.error;
    if (
      removed.status !== 0 &&
      !removed.stderr.includes("No such container") &&
      !removed.stderr.includes("is already in progress")
    ) {
      throw new Error(`Could not remove test container: ${removed.stderr}`);
    }
  }

  docker(args) {
    return this.command("docker", args);
  }

  command(executable, args) {
    const executed = spawnSync(executable, args, {
      encoding: "utf8",
      timeout: 30_000,
      killSignal: "SIGKILL",
    });
    if (executed.error) throw executed.error;
    assert.equal(
      executed.status,
      0,
      `${executable} ${args.join(" ")}: ${executed.stderr}`,
    );
    return executed.stdout;
  }
}

function kernelCounters(input) {
  return Object.fromEntries(
    input
      .trim()
      .split("\n")
      .map((line) => {
        const [key, value] = line.split(" ");
        return [key, Number(value)];
      }),
  );
}
