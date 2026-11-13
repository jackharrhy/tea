import { describe, expect, it } from "vitest";
import worker from "../../worker.ts";

const origin = "https://worldview.harrhy.xyz";
const env = {
  ASSETS: {
    fetch: async () => new Response("asset"),
  },
  MAPS_SERVICE_ORIGIN: "http://service.test",
  MAPS_COLLABORATION_ORIGIN: "http://collaboration.test",
};

describe("Worldview HTML policy", () => {
  it.each(["/viewer", "/editor", "/projects", "/new-map"])(
    "nonces %s without shared caching",
    async (path) => {
      const response = await worker.fetch(new Request(origin + path), env);
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      const policy = response.headers.get("Content-Security-Policy") ?? "";
      const nonce = /script-src[^;]*'nonce-([^']+)'/.exec(policy)?.[1];
      expect(nonce).toBeTruthy();
      expect(policy).toContain("wss://worldview.harrhy.xyz");
      expect(await response.text()).toContain(`nonce="${nonce}"`);
    },
  );
});
