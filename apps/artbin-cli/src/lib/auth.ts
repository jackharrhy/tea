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
  } catch {
    throw new Error("Authentication failed. Run: artbin login");
  }
}
