import { randomBytes } from "crypto";

export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export function buildConfirmUrl(
  baseUrl: string,
  token: string,
  domain?: string,
): string {
  if (domain) {
    return `${baseUrl}/confirm/${token}/${domain}`;
  }
  return `${baseUrl}/confirm/${token}`;
}

export function buildUnsubscribeUrl(
  baseUrl: string,
  token: string,
  listId?: number,
): string {
  if (listId !== undefined) {
    return `${baseUrl}/unsubscribe/${token}/${listId}`;
  }
  return `${baseUrl}/unsubscribe/${token}`;
}

export function buildPreferencesUrl(baseUrl: string, token: string): string {
  return `${baseUrl}/preferences/${token}`;
}

export function buildListUnsubscribeHeader(
  unsubscribeUrl: string,
): Record<string, string> {
  return {
    "List-Unsubscribe": `<${unsubscribeUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
