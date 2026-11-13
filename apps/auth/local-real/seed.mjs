import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

process.umask(0o077);
const state = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../.local-real",
);
const origin = "http://localhost:18887";
const checkpoint = resolve(state, "seed.json");
const operatorPath = resolve(state, "bootstrap/operator.pat");
const loginPath = resolve(state, "bootstrap/login.pat");
if (!existsSync(operatorPath) || !existsSync(loginPath))
  throw new Error(
    "Local ZITADEL is not ready; run npm run auth:real:up first.",
  );
const operator = readFileSync(operatorPath, "utf8").trim();
const login = readFileSync(loginPath, "utf8").trim();
const saved = existsSync(checkpoint)
  ? JSON.parse(readFileSync(checkpoint, "utf8"))
  : {
      steps: {},
      password: `Local-${randomBytes(22).toString("base64url")}!7a`,
    };
const save = () => {
  writeFileSync(checkpoint, JSON.stringify(saved, null, 2) + "\n", {
    mode: 0o600,
  });
  chmodSync(checkpoint, 0o600);
};
save();

async function api(
  path,
  body,
  { method = body === undefined ? "GET" : "POST", token = operator } = {},
) {
  const response = await fetch(new URL(path, origin), {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(saved.steps.organization?.id
        ? { "x-zitadel-orgid": saved.steps.organization.id }
        : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(`Local ZITADEL ${path} returned ${response.status}`);
  return value;
}

async function once(name, create) {
  if (saved.steps[name]) return saved.steps[name];
  if (saved.pending)
    throw new Error(
      `Provisioning interrupted at ${saved.pending}; inspect or reset only the local profile.`,
    );
  saved.pending = name;
  save();
  const value = await create();
  saved.steps[name] = value;
  delete saved.pending;
  save();
  return value;
}

let organization = saved.steps.organization;
if (!organization) {
  const result = await api("/management/v1/orgs/me");
  if (!result.org?.id) throw new Error("Local organization lookup failed");
  organization = { id: result.org.id };
  saved.steps.organization = organization;
  save();
}
const project = await once("project", () =>
  api("/management/v1/projects", {
    name: "Local Artbin",
    projectRoleAssertion: true,
    projectRoleCheck: true,
    hasProjectCheck: true,
  }),
);
await once("memberRole", () =>
  api(`/management/v1/projects/${project.id}/roles`, {
    roleKey: "member",
    displayName: "Member",
  }),
);
const browser = await once("browser", () =>
  api(`/management/v1/projects/${project.id}/apps/oidc`, {
    name: "Local Artbin browser",
    redirectUris: ["http://localhost:18892/auth/callback"],
    responseTypes: ["OIDC_RESPONSE_TYPE_CODE"],
    grantTypes: ["OIDC_GRANT_TYPE_AUTHORIZATION_CODE"],
    appType: "OIDC_APP_TYPE_WEB",
    authMethodType: "OIDC_AUTH_METHOD_TYPE_NONE",
    accessTokenType: "OIDC_TOKEN_TYPE_JWT",
    accessTokenRoleAssertion: true,
    idTokenRoleAssertion: true,
    idTokenUserinfoAssertion: true,
    devMode: true,
    loginVersion: { loginV2: { baseUri: "http://localhost:18888/" } },
  }),
);
const resource = await once("resource", () =>
  api(`/management/v1/projects/${project.id}/apps/api`, {
    name: "Local Artbin resource",
    authMethodType: "API_AUTH_METHOD_TYPE_BASIC",
  }),
);
const user = await once("user", () =>
  api("/v2/users/human", {
    userId: randomUUID(),
    username: "local-artbin",
    organization: { orgId: organization.id },
    profile: {
      givenName: "Local",
      familyName: "Artbin",
      displayName: "Local Artbin",
    },
    email: { email: "local-artbin@example.test", isVerified: true },
    password: { password: saved.password, changeRequired: false },
  }),
);
await once("grant", () =>
  api(`/management/v1/users/${user.userId}/grants`, {
    projectId: project.id,
    roleKeys: ["member"],
  }),
);
const action = await once("principalAction", async () => {
  const script = readFileSync(
    new URL("../integrations/identity-claims.js", import.meta.url),
    "utf8",
  );
  return api("/management/v1/actions", {
    name: "jackIdentity",
    script,
    timeout: "5s",
    allowedToFail: false,
  });
});
await once("principalFlow", async () => {
  const flow = (await api("/management/v1/flows/2")).flow;
  for (const trigger of ["4", "5"]) {
    const row = flow.triggerActions?.find(
      (entry) => entry.triggerType.id === trigger,
    );
    await api(`/management/v1/flows/2/trigger/${trigger}`, {
      actionIds: [...(row?.actions || []).map((entry) => entry.id), action.id],
    });
  }
  return { configured: true };
});

function writePrivate(name, value) {
  const path = resolve(state, name);
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  chmodSync(path, 0o600);
}
writePrivate("login-token.json", { token: login });
writePrivate("management-token.json", { token: operator });
writePrivate("applications.json", [
  {
    id: "artbin",
    name: "Artbin",
    projectId: project.id,
    clientIds: [browser.clientId],
    pkceClientIds: [browser.clientId],
    roles: ["member"],
  },
]);
writePrivate("services.json", [
  {
    id: "artbin",
    name: "Artbin",
    category: "Apps & creative tools",
    url: "http://localhost:18892",
    applicationId: "artbin",
    kind: "central",
    roles: ["member"],
    directorySection: "apps",
    description:
      "Local synthetic Artbin library with the ordinary OAuth callback.",
  },
]);
writePrivate("integrations.json", {
  checkedAt: "local",
  evidence: "synthetic local issuer",
  projects: [],
  applications: [],
});
writePrivate("auth.env.json", {
  PORT: "18888",
  LISTEN_HOST: "127.0.0.1",
  PUBLIC_ORIGIN: "http://localhost:18888",
  ZITADEL_API_URL: origin,
  ORGANIZATION_ID: organization.id,
  LORE_PROJECT_ID: project.id,
  LORE_CLIENT_ID: browser.clientId,
  LOGIN_TOKEN_FILE: resolve(state, "login-token.json"),
  MANAGEMENT_TOKEN_FILE: resolve(state, "management-token.json"),
  AUTH_APPLICATIONS_FILE: resolve(state, "applications.json"),
  AUTH_SERVICES_FILE: resolve(state, "services.json"),
  AUTH_INTEGRATIONS_FILE: resolve(state, "integrations.json"),
  ACCESS_DB_FILE: resolve(state, "access.sqlite"),
});
writePrivate("artbin.env.json", {
  PORT: "18892",
  HOST: "127.0.0.1",
  NODE_ENV: "development",
  ARTBIN_REQUIRE_AUTH: "1",
  ARTBIN_URL: "http://localhost:18892",
  ARTBIN_DB_PATH: resolve(state, "artbin/artbin.sqlite"),
  ARTBIN_PUBLIC_DIR: resolve(state, "artbin/public"),
  ARTBIN_TEMP_DIR: resolve(state, "artbin/tmp"),
  AUTH_ISSUER: origin,
  AUTH_CLIENT_ID: browser.clientId,
  AUTH_PROJECT_ID: project.id,
  AUTH_ORGANIZATION_ID: organization.id,
  AUTH_INTROSPECTION_CLIENT_ID: resource.clientId,
  AUTH_INTROSPECTION_SECRET: resource.clientSecret,
  ARTBIN_SUPPORT_LOGIN_ENABLED: "0",
});
console.log(
  "Synthetic Artbin project, public client, member grant, and native principal action are ready. Local credentials stay under apps/auth/.local-real.",
);
