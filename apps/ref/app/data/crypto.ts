export async function samePassword(
  input: string,
  configured: string,
): Promise<boolean> {
  if (!configured || input.length > 512) return false;
  const [actual, expected] = await Promise.all([
    digest(input),
    digest(configured),
  ]);
  let difference = 0;
  for (let index = 0; index < actual.length; index++)
    difference |= actual[index]! ^ expected[index]!;
  return difference === 0;
}

export async function tokenHash(token: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return hex(new Uint8Array(hash));
}

export function newToken(): string {
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
