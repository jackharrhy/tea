import { it, expect } from "vitest";
import {
  attestCounterPeer,
  counterPeerHeader,
  verifiedCounterPeer,
} from "../app/counter-peer.ts";
const secret = "ab".repeat(32);
it("binds a counter visitor proof to its ingress key, path, method and freshness", async () => {
  const context = {
    ip: "192.0.2.1",
    method: "GET",
    path: "/u/member/counter",
    at: Date.now(),
  };
  const token = await attestCounterPeer(context, secret);
  const req = (path = context.path, method = "GET") =>
    new Request("https://review.invalid" + path, {
      method,
      headers: { [counterPeerHeader]: token, "X-Forwarded-For": "192.0.2.99" },
    });
  expect(await verifiedCounterPeer(req(), secret)).toBe(context.ip);
  expect(await verifiedCounterPeer(req(), "cd".repeat(32))).toBeNull();
  expect(await verifiedCounterPeer(req("/u/other/counter"), secret)).toBeNull();
  expect(
    await verifiedCounterPeer(req(context.path, "POST"), secret),
  ).toBeNull();
  expect(
    await verifiedCounterPeer(req(), secret, context.at + 60001),
  ).toBeNull();
  expect(
    await verifiedCounterPeer(
      new Request("https://review.invalid" + context.path, {
        headers: {
          "X-Forwarded-For": context.ip,
          "CF-Connecting-IP": context.ip,
        },
      }),
      secret,
    ),
  ).toBeNull();
});
