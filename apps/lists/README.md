# tea/lists

Lists is a mailing-list application for subscriptions, campaign editing and delivery, inbound replies, and DMARC reports. The application uses one Bun process, SQLite, AWS SES/SNS/SQS/S3, and a Remix 3 public UI. The admin UI is being moved route by route from the source application; the original deployment remains authoritative until the Tea replacement passes cutover checks.

## Entry points and local setup

`src/index.ts` starts the HTTP server and durable background workers. `src/http-app.ts` mounts the Remix subscription and admin dashboard routes from `app/` alongside the existing API, MCP, OAuth, webhook, and remaining admin routes. The process drains or requeues mail work on SIGTERM before closing SQLite. `src/services/` owns mail and delivery behavior, `src/operations/` owns shared API and MCP operations, and `src/db/` plus `drizzle/` own the SQLite schema and ordered migrations. `emails/` contains the outbound templates.

Install from the Tea root with `npm ci` and use Bun 1.4.4 for execution. For local development, provide the environment described in `LOCAL_DEVELOPMENT.md`; run `npm run dev --workspace @tea/lists`. The app listens on port 8080. The local stack uses mocked AWS services and Mailpit. Do not use production AWS credentials for local tests.

Run `npm run check --workspace @tea/lists` for type checking, the isolated Bun test suite, and browser asset builds. The Compose-backed integration suite is `npm run test:local --workspace @tea/lists` after starting its local dependencies. Tests use synthetic in-memory databases and mocked SES unless explicitly marked as local stack tests.

## Boundaries and deployment

The database is the source of truth for subscriber and campaign state, recipient attempts, API tokens, OAuth records, and operator sessions. The delivery, scheduler, and inbound poller run in the same process. Keep confirmation, unsubscribe, bounce, and complaint behavior intact when changing routes. The production host, AWS resources, secrets, DNS, and cutover are managed in the Infra repository. The existing `lists.jackharrhy.dev` URL must keep working through migration.

Production starts only with `AUTH_ISSUER`, `AUTH_CLIENT_ID`, `AUTH_PROJECT_ID`, and `AUTH_ORGANIZATION_ID` set. Browser sign-in uses the shared `@tea/identity` OIDC client, PKCE S256, signed ID token validation, and an exact `auth_subject` lookup. Imported users retain their local IDs, roles, and list assignments; unknown subjects cannot create an account. The public callback is `${BASE_URL}/auth/callback`. Local Compose deliberately uses `NODE_ENV=development` and a synthetic password account so the mail stack can be exercised without live central credentials. The legacy API/MCP OAuth server remains in this migration branch and must be replaced before production cutover.
