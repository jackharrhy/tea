import {
  parseActiveRealtimeTicketPayload,
  type RealtimeTicketPayload,
} from "@tea/maps-protocol";

export type HostedRealtimeTicket = RealtimeTicketPayload;

function decode(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(
    `${normalized}${"=".repeat((4 - (normalized.length % 4)) % 4)}`,
  );
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function verifyHostedRealtimeTicket(
  ticket: string,
  secret: string,
): Promise<HostedRealtimeTicket | null> {
  const [header, content, signature, extra] = ticket.split(".");
  if (!header || !content || !signature || extra || secret.length < 32)
    return null;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      decode(signature),
      new TextEncoder().encode(`${header}.${content}`),
    );
    if (!valid) return null;
    return parseActiveRealtimeTicketPayload(
      JSON.parse(new TextDecoder().decode(decode(content))),
    );
  } catch {
    return null;
  }
}
