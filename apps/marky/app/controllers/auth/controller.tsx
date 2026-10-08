import * as crypto from "node:crypto";
import { createController } from "remix/router";
import { redirect } from "remix/response/redirect";

import type { DiscordAuthConfig } from "../../config.ts";
import {
  deterministicPaletteColor,
  exchangeCode,
  fetchGuildMember,
  fetchGuildRoles,
  resolveDisplayName,
  resolveRoleColor,
} from "../../data/discord.ts";
import type { IdentityValue } from "../../middleware/auth.ts";
import { routes } from "../../routes.ts";
import { NotInGuildPage } from "./not-in-guild-page.tsx";

const STATE_KEY = "oauth.state";
const IDENTITY_KEY = "identity";

export function createAuthController(deps: { auth: DiscordAuthConfig }) {
  const redirectUri = `${deps.auth.baseUrl}/auth/callback`;
  return createController(routes.auth, {
    actions: {
      signIn(context) {
        const state = crypto.randomBytes(32).toString("hex");
        context.session.set(STATE_KEY, state);
        const params = new URLSearchParams({
          response_type: "code",
          client_id: deps.auth.clientId,
          scope: "identify guilds.members.read",
          redirect_uri: redirectUri,
          state,
          prompt: "none",
        });
        return redirect(`https://discord.com/api/oauth2/authorize?${params}`);
      },
      async callback(context) {
        const { session, request } = context;
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const expected = session.get(STATE_KEY) as string | undefined;
        session.unset(STATE_KEY);
        if (!code || !state || !expected || state !== expected) {
          return new Response(
            "OAuth state mismatch, please try signing in again.",
            {
              status: 400,
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            },
          );
        }

        let exchange;
        try {
          exchange = await exchangeCode({
            clientId: deps.auth.clientId,
            clientSecret: deps.auth.clientSecret,
            code,
            redirectUri,
          });
        } catch (error) {
          console.error("marky: token exchange failed", error);
          return new Response("Discord sign-in failed. Please try again.", {
            status: 502,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }

        let member;
        try {
          member = await fetchGuildMember({
            accessToken: exchange.accessToken,
            guildId: deps.auth.guildId,
          });
        } catch (error) {
          console.error("marky: guild-member fetch failed", error);
          return new Response("Discord sign-in failed. Please try again.", {
            status: 502,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }
        if (!member) return context.render(<NotInGuildPage />, { status: 403 });

        const name = resolveDisplayName(member);
        let color: string | null = null;
        if (deps.auth.botToken) {
          try {
            const roles = await fetchGuildRoles({
              botToken: deps.auth.botToken,
              guildId: deps.auth.guildId,
            });
            color = resolveRoleColor(member.roleIds, roles);
          } catch (error) {
            console.error(
              "marky: roles fetch failed; falling back to palette",
              error,
            );
          }
        }
        if (!color) color = deterministicPaletteColor(member.user.id);

        const identity: IdentityValue = {
          discordId: member.user.id,
          name,
          color,
        };
        session.set(IDENTITY_KEY, identity);
        session.regenerateId(true);
        return redirect(routes.home.href());
      },
      signOut(context) {
        context.session.destroy();
        return redirect(routes.home.href());
      },
    },
  });
}
