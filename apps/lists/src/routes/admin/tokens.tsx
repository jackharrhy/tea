/** @jsxRuntime classic */
/** @jsx Html.createElement */
/** @jsxFrag Html.Fragment */
// oxlint-disable-next-line no-unused-vars -- Html is the classic JSX factory.
import { Html } from "@elysia/html";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { App } from "../../http";
import type { Db } from "../../db";
import type { Config } from "../../config";
import { schema } from "../../db";
import { API_SCOPES, type ApiScope } from "../../services/access";
import { mintApiToken } from "../../services/api-tokens";
import { registerOauthClient } from "../../services/oauth-clients";
import {
  AdminLayout,
  fmtDateTime,
  getFlash,
  setFlash,
  type User,
} from "./layout";
import {
  Button,
  Card,
  FormGroup,
  Input,
  Label,
  PageHeader,
  Table,
  Td,
  Th,
} from "./ui";

function TokenPage({
  db,
  user,
  revealedToken,
  flash,
}: {
  db: Db;
  user: User;
  revealedToken?: string;
  flash?: string;
}) {
  const credentials = db
    .select()
    .from(schema.apiTokens)
    .where(
      and(
        eq(schema.apiTokens.userId, user.id),
        isNull(schema.apiTokens.revokedAt),
      ),
    )
    .orderBy(desc(schema.apiTokens.createdAt))
    .all();
  const oauthClients = db
    .select()
    .from(schema.oauthClients)
    .orderBy(desc(schema.oauthClients.createdAt))
    .all();
  return (
    <AdminLayout title="API tokens" user={user} flash={flash}>
      <PageHeader title="API tokens" />
      <p class="text-sm text-gray-600">
        Tokens inherit your role and list access, then narrow it further with
        scopes.
      </p>
      {revealedToken && (
        <Card>
          <p class="font-semibold mt-0">
            Copy this token now. It will not be shown again.
          </p>
          <code class="block break-all bg-gray-100 p-3 rounded text-sm">
            {revealedToken}
          </code>
        </Card>
      )}
      <Card>
        <form method="post" action="/admin/tokens">
          <FormGroup>
            <Label for="name">Token name</Label>
            <Input id="name" name="name" required />
          </FormGroup>
          <fieldset class="border-0 p-0 mb-4">
            <legend class="text-sm font-medium mb-2">Scopes</legend>
            {API_SCOPES.map((scope) => (
              <label class="block text-sm mb-1">
                <input type="checkbox" name="scopes" value={scope} /> {scope}
              </label>
            ))}
          </fieldset>
          <Button type="submit">Mint token</Button>
        </form>
      </Card>
      <Table>
        <thead>
          <tr>
            <Th>Name</Th>
            <Th>Prefix</Th>
            <Th>Scopes</Th>
            <Th>Last used</Th>
            <Th></Th>
          </tr>
        </thead>
        <tbody>
          {credentials.map((token) => (
            <tr>
              <Td>{token.name}</Td>
              <Td>
                <code>{token.tokenPrefix}…</code>
              </Td>
              <Td>{(JSON.parse(token.scopes) as string[]).join(", ")}</Td>
              <Td>
                {token.lastUsedAt ? fmtDateTime(token.lastUsedAt) : "Never"}
              </Td>
              <Td>
                <form method="post" action={`/admin/tokens/${token.id}/revoke`}>
                  <Button type="submit" variant="danger">
                    Revoke
                  </Button>
                </form>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <h2 class="text-xl font-semibold mt-8">OAuth clients</h2>
      <Card>
        <form method="post" action="/admin/tokens/oauth-clients">
          <FormGroup>
            <Label for="clientName">Client name</Label>
            <Input id="clientName" name="clientName" required />
          </FormGroup>
          <FormGroup>
            <Label for="redirectUris">Redirect URIs (one per line)</Label>
            <textarea
              id="redirectUris"
              name="redirectUris"
              required
              class="w-full border border-gray-300 rounded p-2"
            />
          </FormGroup>
          <Button type="submit">Register OAuth client</Button>
        </form>
      </Card>
      <Table>
        <thead>
          <tr>
            <Th>Name</Th>
            <Th>Client ID</Th>
            <Th>Redirect URIs</Th>
          </tr>
        </thead>
        <tbody>
          {oauthClients.map((client) => (
            <tr>
              <Td>
                <span safe>{client.clientName}</span>
              </Td>
              <Td>
                <code>{client.clientId}</code>
              </Td>
              <Td>
                <span safe>
                  {(JSON.parse(client.redirectUris) as string[]).join(", ")}
                </span>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </AdminLayout>
  );
}

export function mountTokenRoutes(app: App, db: Db, config: Config) {
  app.get("/tokens", (c) =>
    TokenPage({ db, user: c.user as User, flash: getFlash(c) }),
  );
  app.post("/tokens", (c) => {
    const user = c.user as User;
    const body = c.body as Record<string, unknown>;
    const name = String(body.name ?? "").trim();
    const raw = Array.isArray(body.scopes)
      ? body.scopes
      : body.scopes
        ? [body.scopes]
        : [];
    const scopes = raw
      .map(String)
      .filter((scope): scope is ApiScope =>
        API_SCOPES.includes(scope as ApiScope),
      );
    if (!name || scopes.length === 0)
      return c.text("Name and at least one scope are required", 400);
    const result = mintApiToken(
      db,
      user.id,
      name,
      scopes,
      null,
      `${config.baseUrl}/mcp`,
    );
    c.set.status = 201;
    return c.html(TokenPage({ db, user, revealedToken: result.token }));
  });
  app.post("/tokens/:id/revoke", (c) => {
    const user = c.user as User;
    db.update(schema.apiTokens)
      .set({ revokedAt: new Date().toISOString() })
      .where(
        and(
          eq(schema.apiTokens.id, Number(c.params.id)),
          eq(schema.apiTokens.userId, user.id),
        ),
      )
      .run();
    setFlash(c, "Token revoked.");
    return c.redirect("/admin/tokens");
  });
  app.post("/tokens/oauth-clients", (c) => {
    const body = c.body as Record<string, unknown>;
    const redirectUris = String(body.redirectUris ?? "")
      .split(/\r?\n/)
      .map((uri) => uri.trim())
      .filter(Boolean);
    try {
      registerOauthClient(db, String(body.clientName ?? ""), redirectUris);
    } catch (error) {
      return c.text(
        error instanceof Error ? error.message : "Invalid OAuth client",
        400,
      );
    }
    setFlash(c, "OAuth client registered.");
    return c.redirect("/admin/tokens");
  });
}
