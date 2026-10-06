import type { SiteRuntime } from "../site.ts";
export function testSite(dataDir = "tmp/test"): SiteRuntime {
  return {
    id: "test",
    name: "Test site",
    origin: "http://localhost",
    aliases: [],
    preview: false,
    dataDir,
    definition: {
      features: { adornments: true, riso: true },
      publicDir: "tmp/empty-public",
      background: "#ffffff",
      Page: () => () => null,
    },
  };
}
