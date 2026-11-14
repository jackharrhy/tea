import { cliLoopbackTransport } from "./cli-loopback-transport.ts";
if (!process.env.FOURM_CLI_FIXTURE_ORIGIN)
  throw new Error("Explicit private CLI fixture required");
globalThis.fetch = cliLoopbackTransport(
  fetch,
  process.env.FOURM_CLI_FIXTURE_ORIGIN,
);
