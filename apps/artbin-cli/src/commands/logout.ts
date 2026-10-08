import * as p from "@clack/prompts";
import { deleteConfig, loadConfig, getConfigPath } from "../lib/config.ts";

export async function logout() {
  const config = await loadConfig();
  if (!config) {
    p.log.info("Not logged in");
    return;
  }

  await deleteConfig();
  p.log.success(`Logged out from ${config.serverUrl}`);
  p.log.info(`Config removed: ${getConfigPath()}`);
}
