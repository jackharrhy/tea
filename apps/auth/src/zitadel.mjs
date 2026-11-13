import { createCredential } from "./credentials.mjs";

export function createZitadel({
  baseUrl,
  loginTokenFile,
  managementTokenFile,
  organizationId,
}) {
  const tokens = {
    login: createCredential(loginTokenFile, baseUrl),
    management: createCredential(managementTokenFile, baseUrl),
  };
  return async function api(
    path,
    { method = "GET", body, management = false } = {},
  ) {
    const response = await fetch(new URL(path, baseUrl), {
      method,
      headers: {
        authorization: `Bearer ${await tokens[management ? "management" : "login"]()}`,
        "content-type": "application/json",
        ...(path.startsWith("/zitadel.")
          ? { "Connect-Protocol-Version": "1" }
          : {}),
        "x-zitadel-orgid": organizationId,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
      redirect: "error",
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error("Identity service rejected the request");
      error.status = response.status;
      error.code = result.code;
      const passwordErrors = {
        "Password must contain upper case":
          "Include an uppercase letter in your password.",
        "Password must contain lower case":
          "Include a lowercase letter in your password.",
        "Password must contain number": "Include a number in your password.",
        "Password must contain symbol": "Include a symbol in your password.",
      };
      const passwordMessage =
        typeof result.message === "string"
          ? result.message.replace(/ \(DOMAIN-[A-Za-z0-9]+\)$/, "")
          : "";
      if (Object.hasOwn(passwordErrors, passwordMessage))
        error.passwordPolicyMessage = passwordErrors[passwordMessage];
      throw error;
    }
    return result;
  };
}
