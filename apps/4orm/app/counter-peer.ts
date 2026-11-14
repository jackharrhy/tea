export const counterPeerHeader = "x-fourm-counter-context";
interface PeerContext {
  ip: string;
  method: string;
  path: string;
  at: number;
}
const encode = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
function decode(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw Error("Invalid context encoding");
  return Uint8Array.from(
    atob(value.replaceAll("-", "+").replaceAll("_", "/")),
    (c) => c.charCodeAt(0),
  );
}
async function key(secret: string) {
  if (!/^[a-f0-9]{64}$/.test(secret))
    throw Error("Invalid counter ingress key");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
export async function attestCounterPeer(context: PeerContext, secret: string) {
  const payload = encode(new TextEncoder().encode(JSON.stringify(context)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await key(secret),
    new TextEncoder().encode(payload),
  );
  return payload + "." + encode(new Uint8Array(signature));
}
export async function verifiedCounterPeer(
  request: Request,
  secret: string,
  now = Date.now(),
): Promise<string | null> {
  try {
    const token = request.headers.get(counterPeerHeader) ?? "";
    if (token.length > 1024) return null;
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    if (
      !(await crypto.subtle.verify(
        "HMAC",
        await key(secret),
        decode(parts[1]),
        new TextEncoder().encode(parts[0]),
      ))
    )
      return null;
    const value = JSON.parse(
      new TextDecoder().decode(decode(parts[0])),
    ) as PeerContext;
    if (
      typeof value.ip !== "string" ||
      value.ip.length > 64 ||
      !/^[0-9a-fA-F:.]+$/.test(value.ip) ||
      !Number.isSafeInteger(value.at) ||
      value.at > now + 5000 ||
      now - value.at > 60000 ||
      value.method !== request.method ||
      value.path !== new URL(request.url).pathname
    )
      return null;
    return value.ip;
  } catch {
    return null;
  }
}
