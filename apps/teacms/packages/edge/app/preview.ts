const encoder = new TextEncoder();

async function mac(message: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return [
    ...new Uint8Array(
      await crypto.subtle.sign("HMAC", key, encoder.encode(message)),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function equal(a: string, b: string) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++)
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

export async function createPreviewToken(
  collection: string,
  slug: string,
  secret: string,
  now = Date.now(),
) {
  const expiry = Math.floor(now / 1000) + 15 * 60;
  return `${expiry}.${await mac(`${collection}:${slug}:${expiry}`, secret)}`;
}

export async function verifyPreviewToken(
  token: string,
  collection: string,
  slug: string,
  secret: string,
  now = Date.now(),
) {
  const [expiry, signature, extra] = token.split(".");
  if (
    extra ||
    !/^\d+$/.test(expiry ?? "") ||
    !/^[a-f0-9]{64}$/.test(signature ?? "")
  )
    return false;
  const seconds = Number(expiry);
  if (seconds <= now / 1000 || seconds > now / 1000 + 15 * 60) return false;
  return equal(signature, await mac(`${collection}:${slug}:${expiry}`, secret));
}
