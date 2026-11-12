import { createHash, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";

const output = process.argv[2];
if (!output) throw new Error("Usage: node token.mjs /private/token-file");
const issuer = process.env.HARRHY_DEV_AUTH_ORIGIN ?? "http://127.0.0.1:8786";
const callback =
  process.env.HARRHY_DEV_AUTH_CALLBACK ?? "http://127.0.0.1:8787/auth/callback";
const clientId = process.env.HARRHY_DEV_AUTH_CLIENT_ID ?? "ref-local-browser";
const projectId = process.env.HARRHY_DEV_AUTH_PROJECT_ID ?? "ref-local-project";
const roles = (
  process.env.HARRHY_DEV_AUTH_ROLES ?? "admin,archive-read,archive-restore"
).split(",");
const random = () => randomBytes(32).toString("base64url");
const verifier = random() + random().slice(0, 16);
const state = random();
const nonce = random();
const challenge = createHash("sha256").update(verifier).digest("base64url");
const discovery = await fetch(
  `${issuer}/.well-known/openid-configuration`,
).then((response) => response.json());
if (discovery.issuer !== issuer) throw new Error("Local issuer mismatch");
const authorization = new URL(discovery.authorization_endpoint);
authorization.search = new URLSearchParams({
  response_type: "code",
  client_id: clientId,
  redirect_uri: callback,
  scope: [
    "openid",
    "profile",
    `urn:zitadel:iam:org:project:id:${projectId}:aud`,
    "urn:zitadel:iam:org:projects:roles",
    ...roles.map((role) => `urn:zitadel:iam:org:project:role:${role}`),
  ].join(" "),
  state,
  nonce,
  code_challenge: challenge,
  code_challenge_method: "S256",
});
const page = await fetch(authorization).then((response) => response.text());
const ticket = /name="ticket" value="([A-Za-z0-9_-]+)"/.exec(page)?.[1];
if (!ticket) throw new Error("Local authorization did not start");
const confirmed = await fetch(`${issuer}/dev/continue`, {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    Origin: issuer,
  },
  body: new URLSearchParams({ ticket }),
  redirect: "manual",
});
const result = new URL(confirmed.headers.get("Location") ?? "", callback);
if (
  confirmed.status !== 303 ||
  result.origin !== new URL(callback).origin ||
  result.searchParams.get("state") !== state ||
  !result.searchParams.get("code")
)
  throw new Error("Local authorization failed");
const exchanged = await fetch(discovery.token_endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    code: result.searchParams.get("code"),
    code_verifier: verifier,
    redirect_uri: callback,
  }),
});
if (!exchanged.ok) throw new Error("Local token exchange failed");
const token = await exchanged.json();
if (typeof token.access_token !== "string" || !token.access_token)
  throw new Error("Local token response was invalid");
await writeFile(output, token.access_token, { mode: 0o600, flag: "wx" });
