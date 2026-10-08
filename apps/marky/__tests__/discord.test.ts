import * as assert from "remix/assert";
import { beforeEach, describe, it } from "remix/test";

import {
  resetRolesCacheForTests,
  deterministicPaletteColor,
  exchangeCode,
  fetchGuildMember,
  fetchGuildRoles,
  resolveDisplayName,
  resolveRoleColor,
  type Role,
} from "../app/data/discord.ts";
import { PALETTE_COLORS } from "../app/shared/palette.ts";

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

function mockFetch(handler: (call: FetchCall) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    const call = { url, init };
    calls.push(call);
    return handler(call);
  };
  return { fetchImpl, calls };
}

describe("exchangeCode", () => {
  it("posts the OAuth body and parses the response", async () => {
    const { fetchImpl, calls } = mockFetch(
      () =>
        new Response(
          JSON.stringify({
            access_token: "tok",
            token_type: "Bearer",
            expires_in: 604800,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );

    const result = await exchangeCode(
      {
        clientId: "cid",
        clientSecret: "csecret",
        code: "abc",
        redirectUri: "https://m/callback",
      },
      fetchImpl,
    );

    assert.equal(result.accessToken, "tok");
    assert.equal(result.tokenType, "Bearer");
    assert.equal(result.expiresIn, 604800);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://discord.com/api/oauth2/token");
    assert.equal(calls[0].init?.method, "POST");

    const body = String(calls[0].init?.body);
    assert.match(body, /client_id=cid/);
    assert.match(body, /client_secret=csecret/);
    assert.match(body, /code=abc/);
    assert.match(body, /grant_type=authorization_code/);
    assert.match(body, /redirect_uri=https%3A%2F%2Fm%2Fcallback/);
  });

  it("throws on non-2xx", async () => {
    const { fetchImpl } = mockFetch(
      () => new Response('{"error":"invalid_grant"}', { status: 400 }),
    );
    await assert.rejects(
      () =>
        exchangeCode(
          { clientId: "c", clientSecret: "s", code: "x", redirectUri: "r" },
          fetchImpl,
        ),
      /Discord token exchange failed/,
    );
  });
});

describe("fetchGuildMember", () => {
  it("returns a parsed member on 200", async () => {
    const { fetchImpl, calls } = mockFetch(
      () =>
        new Response(
          JSON.stringify({
            nick: "serverNick",
            roles: ["111", "222"],
            user: { id: "42", username: "jack", global_name: "Jack H" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );

    const member = await fetchGuildMember(
      { accessToken: "tok", guildId: "gid" },
      fetchImpl,
    );

    assert.ok(member);
    assert.equal(member.nick, "serverNick");
    assert.deepEqual(member.roleIds, ["111", "222"]);
    assert.equal(member.user.id, "42");
    assert.equal(member.user.username, "jack");
    assert.equal(member.user.globalName, "Jack H");
    assert.equal(
      calls[0].url,
      "https://discord.com/api/users/@me/guilds/gid/member",
    );
    assert.equal(
      (calls[0].init!.headers as Record<string, string>)["Authorization"],
      "Bearer tok",
    );
  });

  it("returns null on 404", async () => {
    const { fetchImpl } = mockFetch(() => new Response("", { status: 404 }));
    const result = await fetchGuildMember(
      { accessToken: "tok", guildId: "gid" },
      fetchImpl,
    );
    assert.equal(result, null);
  });

  it("handles a missing global_name", async () => {
    const { fetchImpl } = mockFetch(
      () =>
        new Response(
          JSON.stringify({
            nick: null,
            roles: [],
            user: { id: "7", username: "someone", global_name: null },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const member = await fetchGuildMember(
      { accessToken: "tok", guildId: "gid" },
      fetchImpl,
    );
    assert.ok(member);
    assert.equal(member.user.globalName, null);
  });

  it("throws on other non-2xx errors", async () => {
    const { fetchImpl } = mockFetch(
      () => new Response("rate limited", { status: 429 }),
    );
    await assert.rejects(
      () => fetchGuildMember({ accessToken: "tok", guildId: "gid" }, fetchImpl),
      /Discord guild-member fetch failed/,
    );
  });
});

describe("fetchGuildRoles + caching", () => {
  beforeEach(() => resetRolesCacheForTests());

  it("uses the bot token and parses roles", async () => {
    const { fetchImpl, calls } = mockFetch(
      () =>
        new Response(
          JSON.stringify([
            { id: "1", name: "admin", color: 0xff0000, position: 5 },
            { id: "2", name: "member", color: 0, position: 1 },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );

    const roles = await fetchGuildRoles(
      { botToken: "bot", guildId: "gid" },
      { fetchImpl, now: () => 0 },
    );
    assert.equal(roles.length, 2);
    assert.equal(roles[0].id, "1");
    assert.equal(roles[0].color, 0xff0000);
    assert.equal(roles[0].position, 5);
    assert.equal(calls[0].url, "https://discord.com/api/guilds/gid/roles");
    assert.equal(
      (calls[0].init!.headers as Record<string, string>)["Authorization"],
      "Bot bot",
    );
  });

  it("caches results within the TTL", async () => {
    let callCount = 0;
    const fetchImpl: typeof fetch = async () => {
      callCount++;
      return new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    let nowMs = 1_000;
    const opts = { fetchImpl, now: () => nowMs };

    await fetchGuildRoles({ botToken: "bot", guildId: "gid" }, opts);
    nowMs += 30 * 60 * 1000; // 30 minutes
    await fetchGuildRoles({ botToken: "bot", guildId: "gid" }, opts);

    assert.equal(callCount, 1);
  });

  it("refetches after TTL expires", async () => {
    let callCount = 0;
    const fetchImpl: typeof fetch = async () => {
      callCount++;
      return new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    let nowMs = 1_000;
    const opts = { fetchImpl, now: () => nowMs };

    await fetchGuildRoles({ botToken: "bot", guildId: "gid" }, opts);
    nowMs += 61 * 60 * 1000; // 61 minutes
    await fetchGuildRoles({ botToken: "bot", guildId: "gid" }, opts);

    assert.equal(callCount, 2);
  });

  it("caches per guild id", async () => {
    let callCount = 0;
    const fetchImpl: typeof fetch = async () => {
      callCount++;
      return new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const opts = { fetchImpl, now: () => 0 };

    await fetchGuildRoles({ botToken: "bot", guildId: "a" }, opts);
    await fetchGuildRoles({ botToken: "bot", guildId: "b" }, opts);
    assert.equal(callCount, 2);
  });
});

describe("resolveDisplayName", () => {
  const baseUser = { id: "1", username: "jack", globalName: "Jack H" };

  it("prefers nick when set", () => {
    assert.equal(
      resolveDisplayName({ nick: "NickName", roleIds: [], user: baseUser }),
      "NickName",
    );
  });

  it("falls back to globalName when nick is null", () => {
    assert.equal(
      resolveDisplayName({ nick: null, roleIds: [], user: baseUser }),
      "Jack H",
    );
  });

  it("falls back to username when nick and globalName are null", () => {
    assert.equal(
      resolveDisplayName({
        nick: null,
        roleIds: [],
        user: { ...baseUser, globalName: null },
      }),
      "jack",
    );
  });

  it("treats empty-string nick as falsy", () => {
    assert.equal(
      resolveDisplayName({ nick: "", roleIds: [], user: baseUser }),
      "Jack H",
    );
  });
});

describe("resolveRoleColor", () => {
  const roles: Role[] = [
    { id: "1", name: "everyone", color: 0, position: 0 },
    { id: "2", name: "support", color: 0x00ff00, position: 3 },
    { id: "3", name: "admin", color: 0xff0000, position: 10 },
    { id: "4", name: "transparent-top", color: 0, position: 99 },
  ];

  it("returns the highest-positioned colored role", () => {
    assert.equal(resolveRoleColor(["1", "2", "3", "4"], roles), "#ff0000");
  });

  it("skips roles with color zero, even if they are higher", () => {
    assert.equal(resolveRoleColor(["2", "4"], roles), "#00ff00");
  });

  it("returns null when all roles have color zero", () => {
    assert.equal(resolveRoleColor(["1", "4"], roles), null);
  });

  it("returns null with no role ids", () => {
    assert.equal(resolveRoleColor([], roles), null);
  });

  it("ignores role ids not in the role list", () => {
    assert.equal(resolveRoleColor(["unknown"], roles), null);
  });

  it("formats colors with leading zeros", () => {
    const padded: Role[] = [
      { id: "1", name: "low", color: 0x00ff00, position: 1 },
    ];
    assert.equal(resolveRoleColor(["1"], padded), "#00ff00");
  });
});

describe("deterministicPaletteColor", () => {
  it("returns a value from the shared palette", () => {
    const color = deterministicPaletteColor("123");
    assert.ok(
      PALETTE_COLORS.includes(color as (typeof PALETTE_COLORS)[number]),
    );
  });

  it("is stable for the same id", () => {
    assert.equal(
      deterministicPaletteColor("abc"),
      deterministicPaletteColor("abc"),
    );
  });

  it("differs for sufficiently different ids", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 32; i++)
      seen.add(deterministicPaletteColor(`user-${i}`));
    assert.ok(
      seen.size > 1,
      "expected multiple palette colors across distinct ids",
    );
  });
});
