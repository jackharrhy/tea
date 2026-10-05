import {
  AuthenticationError,
  type IdentityProvider,
} from "@tea/shell-core/auth/types.ts";

export const lockedIdentity: IdentityProvider = {
  async verify() {
    throw new AuthenticationError();
  },
};

export const demoIdentity: IdentityProvider = {
  async verify(token) {
    if (token !== "demo-only-token") throw new AuthenticationError();
    return {
      issuer: "urn:tea:shell-mcp:demo",
      subject: "demo",
      username: "demo",
      admin: true,
      expiresAt: Date.now() + 60_000,
    };
  },
};
