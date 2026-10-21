import { ApiClient } from "./api.ts";
import { loadConfig } from "./config.ts";

export async function getAuthenticatedClient() {
  const config = await loadConfig();
  if (!config) {
    throw new Error("Not logged in. Run: artbin login");
  }

  const api = new ApiClient(config);
  try {
    const { user } = await api.whoami();
    return { api, user, config };
  } catch (error) {
    if (
      error instanceof Error &&
      /whoami failed \((401|403)\)/.test(error.message)
    ) {
      throw new Error("Session expired. Run: artbin login", { cause: error });
    }
    throw new Error(
      `Could not connect to Artbin at ${config.serverUrl}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
