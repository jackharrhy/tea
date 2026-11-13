import { it, expect, vi } from "vitest";
import {
  createECDH,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  verify,
  createPublicKey,
} from "node:crypto";
import { deliverPush } from "../app/push-delivery.ts";
import type { Bindings, Runtime } from "../app/runtime.ts";

it("encrypts the original payload, signs VAPID, and scopes expired-subscription cleanup", async () => {
  const receiver = createECDH("prime256v1");
  receiver.generateKeys();
  const vapid = createECDH("prime256v1");
  vapid.generateKeys();
  const auth = randomBytes(16);
  const environment = {
    VAPID_PUBLIC_KEY: vapid.getPublicKey().toString("base64url"),
    VAPID_PRIVATE_KEY: vapid.getPrivateKey().toString("base64url"),
    VAPID_SUBJECT: "mailto:isolated@example.invalid",
  } as Bindings;
  const call = vi.fn(async () => undefined);
  const store = { call } as unknown as Runtime;
  const messages = [201, 410, 503].map((status, index) => ({
    subscription: {
      id: index + 1,
      endpoint: `https://push.invalid/${status}`,
      p256dh_key: receiver.getPublicKey().toString("base64url"),
      auth_key: auth.toString("base64url"),
    },
    title: "New reply in Topic",
    body: "Member replied",
    url: "/forum/1#post-2",
  }));
  let sends = 0;
  const send: typeof fetch = async (input, init) => {
    const endpoint = String(input);
    expect(endpoint).toMatch(/^https:\/\/push.invalid\//);
    expect(init?.redirect).toBe("error");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const headers = new Headers(init?.headers);
    expect(headers.get("content-encoding")).toBe("aes128gcm");
    const authorization = headers.get("authorization")!;
    const token = /^vapid t=([^,]+), k=(.+)$/.exec(authorization)!;
    expect(token).not.toBeNull();
    expect(token[2]).toBe(environment.VAPID_PUBLIC_KEY);
    const [header, claims, signature] = token[1].split(".");
    const jwk = {
      kty: "EC",
      crv: "P-256",
      x: vapid.getPublicKey().subarray(1, 33).toString("base64url"),
      y: vapid.getPublicKey().subarray(33).toString("base64url"),
    };
    expect(
      verify(
        "sha256",
        Buffer.from(header + "." + claims),
        {
          key: createPublicKey({ key: jwk, format: "jwk" }),
          dsaEncoding: "ieee-p1363",
        },
        Buffer.from(signature, "base64url"),
      ),
    ).toBe(true);
    const claim = JSON.parse(Buffer.from(claims, "base64url").toString());
    expect(claim.aud).toBe("https://push.invalid");
    expect(claim.sub).toBe(environment.VAPID_SUBJECT);
    expect(claim.exp).toBeGreaterThan(Date.now() / 1000);
    expect(claim.exp).toBeLessThan(Date.now() / 1000 + 86400);
    const body = Buffer.from(init!.body as Uint8Array);
    expect(body.length).toBe(4096);
    expect(body.readUInt32BE(16)).toBe(4096);
    expect(body[20]).toBe(65);
    const server = body.subarray(21, 86),
      salt = body.subarray(0, 16);
    const shared = receiver.computeSecret(server);
    const ikm = Buffer.from(
      hkdfSync(
        "sha256",
        shared,
        auth,
        Buffer.concat([
          Buffer.from("WebPush: info\0"),
          receiver.getPublicKey(),
          server,
        ]),
        32,
      ),
    );
    const key = Buffer.from(
      hkdfSync(
        "sha256",
        ikm,
        salt,
        Buffer.from("Content-Encoding: aes128gcm\0"),
        16,
      ),
    );
    const nonce = Buffer.from(
      hkdfSync(
        "sha256",
        ikm,
        salt,
        Buffer.from("Content-Encoding: nonce\0"),
        12,
      ),
    );
    const encrypted = body.subarray(86);
    const decipher = createDecipheriv("aes-128-gcm", key, nonce);
    decipher.setAuthTag(encrypted.subarray(-16));
    const plaintext = Buffer.concat([
      decipher.update(encrypted.subarray(0, -16)),
      decipher.final(),
    ]);
    let delimiter = plaintext.length - 1;
    while (plaintext[delimiter] === 0) delimiter--;
    expect(plaintext[delimiter]).toBe(2);
    expect(JSON.parse(plaintext.subarray(0, delimiter).toString())).toEqual({
      title: "New reply in Topic",
      body: "Member replied",
      url: "/forum/1#post-2",
    });
    sends++;
    return new Response(null, {
      status: Number(new URL(endpoint).pathname.slice(1)),
    });
  };
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await deliverPush({} as Bindings, store, messages, send);
    expect(sends).toBe(0);
    await deliverPush(environment, store, messages, send);
    expect(sends).toBe(3);
    expect(call).toHaveBeenCalledExactlyOnceWith(
      "expirePushSubscription",
      2,
      messages[1].subscription.endpoint,
      messages[1].subscription.p256dh_key,
      messages[1].subscription.auth_key,
    );
    expect(log).toHaveBeenCalledWith("Push delivery rejected", 503);
  } finally {
    log.mockRestore();
  }
});
