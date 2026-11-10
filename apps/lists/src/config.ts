import type { IdentityConfig } from "@tea/identity";

export type Config = {
  awsRegion: string;
  sqsQueueUrl: string;
  s3Bucket: string;
  dbPath: string;
  fromDomain: string;
  baseUrl: string;
  sesConfigSet: string;
  s3MediaBucket: string;
  s3MediaBaseUrl: string;
  ownerEmail: string;
  ownerPassword: string;
  publicSubscriptionsEnabled?: boolean;
  oauthDynamicRegistrationEnabled?: boolean;
  awsEndpointUrl?: string;
  smtpUrl?: string;
  shutdownSignal?: AbortSignal;
  identity?: IdentityConfig;
  introspectionCredentials?: { clientId: string; clientSecret: string };
};

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`${key} is required`);
  return val;
}

export function loadConfig(): Config {
  const identityKeys = [
    "AUTH_ISSUER",
    "AUTH_CLIENT_ID",
    "AUTH_PROJECT_ID",
    "AUTH_ORGANIZATION_ID",
  ] as const;
  const identityValues = identityKeys.map((key) => process.env[key]);
  if (identityValues.some(Boolean) && identityValues.some((value) => !value)) {
    throw new Error("Incomplete central identity configuration");
  }
  if (process.env.NODE_ENV === "production" && !identityValues.every(Boolean)) {
    throw new Error("Central identity configuration is required in production");
  }
  const identity = identityValues.every(Boolean)
    ? {
        issuer: identityValues[0]!,
        clientId: identityValues[1]!,
        projectId: identityValues[2]!,
        organizationId: identityValues[3]!,
      }
    : undefined;
  const introspectionId = process.env.AUTH_INTROSPECTION_CLIENT_ID;
  const introspectionSecret = process.env.AUTH_INTROSPECTION_SECRET;
  if (Boolean(introspectionId) !== Boolean(introspectionSecret))
    throw new Error("Incomplete introspection configuration");
  if (
    identity &&
    process.env.NODE_ENV === "production" &&
    (!introspectionId || !introspectionSecret)
  ) {
    throw new Error(
      "Central introspection configuration is required in production",
    );
  }

  return {
    awsRegion: process.env.AWS_REGION ?? "us-east-1",
    sqsQueueUrl: required("SQS_QUEUE_URL"),
    s3Bucket: required("S3_BUCKET"),
    dbPath: process.env.DB_PATH ?? "lists.db",
    fromDomain: process.env.FROM_DOMAIN ?? "jackharrhy.dev",
    baseUrl: required("BASE_URL"),
    sesConfigSet: process.env.SES_CONFIG_SET ?? "",
    s3MediaBucket: process.env.S3_MEDIA_BUCKET ?? "",
    s3MediaBaseUrl: process.env.S3_MEDIA_BASE_URL ?? "",
    ownerEmail: process.env.OWNER_EMAIL ?? "",
    ownerPassword: process.env.OWNER_PASSWORD ?? "",
    publicSubscriptionsEnabled:
      process.env.PUBLIC_SUBSCRIPTIONS_ENABLED === "true",
    oauthDynamicRegistrationEnabled:
      process.env.OAUTH_DYNAMIC_REGISTRATION_ENABLED === "true",
    awsEndpointUrl: process.env.AWS_ENDPOINT_URL || undefined,
    smtpUrl: process.env.SMTP_URL || undefined,
    identity,
    introspectionCredentials:
      introspectionId && introspectionSecret
        ? { clientId: introspectionId, clientSecret: introspectionSecret }
        : undefined,
  };
}
