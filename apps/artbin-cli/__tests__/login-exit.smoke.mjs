import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform === "win32") {
  console.log("Login exit smoke is skipped on Windows.");
  process.exit(0);
}

const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const scratch = await mkdtemp(join(tmpdir(), "artbin-login-exit-"));
const bin = join(scratch, "bin");
const browserCommand = process.platform === "darwin" ? "open" : "xdg-open";
const server = createServer((request, response) => {
  response.setHeader("Content-Type", "application/json");
  if (request.url === "/auth/cli/redeem") {
    response.end(JSON.stringify({ session: "smoke-session" }));
  } else if (request.url === "/api/cli/whoami") {
    response.end(
      JSON.stringify({
        user: { id: "smoke-user", name: "smoke-user", isAdmin: false },
      }),
    );
  } else {
    response.writeHead(404).end();
  }
});

try {
  await mkdir(bin);
  await writeFile(
    join(bin, browserCommand),
    `#!/usr/bin/env node
const url = new URL(process.argv.at(-1));
const port = url.searchParams.get("port");
fetch("http://127.0.0.1:" + port + "/callback?code=smoke-handoff").catch(() => {});
setTimeout(() => {}, 10_000);
`,
    { mode: 0o755 },
  );

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not start fake Artbin server");
  }

  const child = spawn(
    process.execPath,
    [cli, "login", `http://127.0.0.1:${address.port}`],
    {
      env: {
        ...process.env,
        ARTBIN_SERVER_URL: "",
        ARTBIN_SESSION_ID: "",
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        XDG_CONFIG_HOME: join(scratch, "config"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, 4_000);
  const [exitCode] = await once(child, "exit");
  clearTimeout(timeout);

  if (
    timedOut ||
    exitCode !== 0 ||
    !output.includes("Authentication complete")
  ) {
    throw new Error(`Login did not exit after authentication:\n${output}`);
  }
  console.log(
    "Login completed and exited while the browser launcher stayed open.",
  );
} finally {
  server.close();
  await rm(scratch, { recursive: true, force: true });
}
