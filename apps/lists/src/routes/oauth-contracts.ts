import { z } from "zod";

const authorizationFields = {
  client_id: z.string().min(1),
  redirect_uri: z.url(),
  response_type: z.literal("code"),
  scope: z.string().optional(),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal("S256"),
  state: z.string().optional(),
  resource: z.url().optional(),
};

export const oauthRegistrationInput = z
  .object({
    client_name: z.string().min(1).max(255).optional(),
    redirect_uris: z.array(z.url()).min(1),
    token_endpoint_auth_method: z.string().optional(),
    grant_types: z.array(z.string()).optional(),
    response_types: z.array(z.string()).optional(),
    scope: z.string().optional(),
  })
  .passthrough();

export const oauthAuthorizationQuery = z.object(authorizationFields).strict();

export const oauthAuthorizationDecision = z
  .object({
    ...authorizationFields,
    decision: z.enum(["allow", "deny"]),
  })
  .strict();

export const oauthTokenInput = z.discriminatedUnion("grant_type", [
  z
    .object({
      grant_type: z.literal("authorization_code"),
      code: z.string().min(1),
      client_id: z.string().min(1),
      redirect_uri: z.url(),
      code_verifier: z.string().min(43).max(128),
      resource: z.url().optional(),
    })
    .passthrough(),
  z
    .object({
      grant_type: z.literal("refresh_token"),
      refresh_token: z.string().min(1),
      client_id: z.string().min(1),
      scope: z.string().optional(),
      resource: z.url().optional(),
    })
    .passthrough(),
]);
