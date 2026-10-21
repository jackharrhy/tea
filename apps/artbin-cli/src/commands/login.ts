import * as p from "@clack/prompts";
import { createServer } from "node:http";
import open from "open";
import { loadConfig, saveConfig, getDefaultServerUrl } from "../lib/config.ts";
import { ApiClient } from "../lib/api.ts";

export async function login(args: Record<string, unknown>) {
  p.intro("artbin login");

  const serverUrl = (args._ as string[])?.[1] || getDefaultServerUrl();

  const existing = await loadConfig();
  if (existing) {
    const shouldContinue = await p.confirm({
      message: `Already logged in to ${existing.serverUrl}. Re-authenticate?`,
    });
    if (p.isCancel(shouldContinue) || !shouldContinue) {
      p.outro("Cancelled");
      return;
    }
  }

  const handoffCode = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("Login timed out after 2 minutes"));
    }, 120_000);

    const server = createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost`);
      if (url.pathname === "/callback") {
        const code = url.searchParams.get("code");
        if (code) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(
            "<html><body><h1>Login successful!</h1><p>You can close this tab.</p></body></html>",
          );
          clearTimeout(timeout);
          server.close();
          resolve(code);
        } else {
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end("Missing handoff code");
        }
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        clearTimeout(timeout);
        reject(new Error("Failed to start local server"));
        return;
      }

      const port = addr.port;
      const authorizeUrl = `${serverUrl}/auth/cli/authorize?port=${port}`;

      p.log.info(`Opening browser to authenticate...`);
      p.log.info(`If the browser doesn't open, visit: ${authorizeUrl}`);
      void open(authorizeUrl).catch(() => {
        p.log.warning(
          "Could not open the browser. Use the URL above to continue.",
        );
      });
    });
  });

  const spinner = p.spinner();
  spinner.start("Completing login...");

  let sessionId: string;
  try {
    sessionId = await redeemCliHandoff(serverUrl, handoffCode);
  } catch (err) {
    spinner.stop("Login failed");
    p.log.error(String(err));
    process.exitCode = 1;
    return;
  }

  const config = { serverUrl, sessionId };
  const api = new ApiClient(config);

  try {
    const { user } = await api.whoami();
    await saveConfig(config);
    spinner.stop(`Logged in as ${user.name}`);
    p.outro("Authentication complete");
  } catch (err) {
    spinner.stop("Verification failed");
    p.log.error(String(err));
    process.exit(1);
  }
}

export async function redeemCliHandoff(
  serverUrl: string,
  code: string,
): Promise<string> {
  const response = await fetch(new URL("/auth/cli/redeem", serverUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!response.ok)
    throw new Error(`Login redemption failed (${response.status})`);
  const payload: unknown = await response.json();
  const sessionId =
    payload &&
    typeof payload === "object" &&
    typeof (payload as { session?: unknown }).session === "string"
      ? (payload as { session: string }).session
      : "";
  if (!sessionId)
    throw new Error("Login redemption returned an invalid session");
  return sessionId;
}
