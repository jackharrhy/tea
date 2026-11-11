import { createServer } from "node:http";
import { resolve } from "node:path";
import { createRequestListener } from "remix/node-fetch-server";
import { createPortal } from "./app/router.js";
import { createIdentity } from "./app/identity.js";
import { parseBindings } from "./app/services.js";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
const origin = process.env.APP_ORIGIN ?? "https://rotund.org";
const issuer = process.env.AUTH_ISSUER ?? "https://auth.jackharrhy.dev";
for (const value of [origin, issuer]) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.origin !== value ||
    url.username ||
    url.password
  )
    throw new Error("App and issuer must be canonical HTTPS origins");
}
const organizationId = required("AUTH_ORGANIZATION_ID");
const bindings = parseBindings(required("SERVICE_BINDINGS"));
const identity = await createIdentity({
  issuer,
  clientId: required("AUTH_CLIENT_ID"),
  clientSecret: required("AUTH_CLIENT_SECRET"),
  scopes: required("AUTH_SCOPES"),
  origin,
});
const app = createPortal({
  origin,
  issuerOrigin: issuer,
  organizationId,
  bindings,
  identity,
  sessionSecret: required("SESSION_SECRET"),
  publicDir: resolve(import.meta.dirname, "public"),
});
const server = createServer(createRequestListener(app.fetch));
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(Number(process.env.PORT ?? 80), "0.0.0.0", () =>
  console.log("rotund.org ready"),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  });
