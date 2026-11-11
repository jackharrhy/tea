export interface IdentityValue {
  discordId?: string;
  subject?: string;
  expiresAt?: number;
  name: string;
  color: string;
}

export function validCentralIdentity(value: unknown): value is IdentityValue {
  if (!value || typeof value !== "object") return false;
  const identity = value as Partial<IdentityValue>;
  return (
    typeof identity.subject === "string" &&
    identity.subject.length > 0 &&
    typeof identity.name === "string" &&
    typeof identity.color === "string" &&
    typeof identity.expiresAt === "number" &&
    identity.expiresAt > Date.now()
  );
}
