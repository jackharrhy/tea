# Lists API and MCP

The REST API and MCP server are transports over the same operations and authorization policy.
Credentials belong to an existing Lists user, inherit that user's role and list assignments, and
are further restricted by scopes.

## Personal access tokens

Sign in to `/admin/tokens` to mint or revoke a token. A token is shown once; only its SHA-256 hash
is stored. Send it as `Authorization: Bearer lst_...`.

Scopes:

- `lists:read`
- `subscribers:read`, `subscribers:write`
- `campaigns:read`, `campaigns:write`, `campaigns:send`
- `templates:read`, `templates:write`
- `deliverability:read`
- `dmarc:read`

## REST API

The versioned base path is `/api/v1`.

| Method           | Path                             | Scope                                    |
| ---------------- | -------------------------------- | ---------------------------------------- |
| GET              | `/lists`                         | `lists:read`                             |
| GET              | `/lists/:id/stats`               | `lists:read`                             |
| GET, POST        | `/subscribers`                   | `subscribers:read` / `subscribers:write` |
| GET, DELETE      | `/subscribers/:id`               | `subscribers:read` / `subscribers:write` |
| POST             | `/subscribers/:id/unsubscribe`   | `subscribers:write`                      |
| GET, POST        | `/campaigns`                     | `campaigns:read` / `campaigns:write`     |
| GET, PUT         | `/campaigns/:id`                 | `campaigns:read` / `campaigns:write`     |
| GET              | `/campaigns/:id/preview`         | `campaigns:read`                         |
| GET              | `/campaigns/:id/sends`           | `campaigns:read`                         |
| POST             | `/campaigns/:id/send`            | `campaigns:send`                         |
| POST             | `/campaigns/:id/test-send`       | `campaigns:send`                         |
| GET              | `/deliverability`                | `deliverability:read`                    |
| GET              | `/dmarc`                         | `dmarc:read`                             |
| GET, POST        | `/email-templates`               | `templates:read` / `templates:write`     |
| GET, PUT, DELETE | `/email-templates/:slug`         | `templates:read` / `templates:write`     |
| POST             | `/email-templates/:slug/preview` | `templates:read`                         |

Destructive actions and sending require explicit confirmation. Campaign send bodies must contain
`{"confirm":true}`; subscriber deletion requires `?confirm=true`.

`POST /subscribers` accepts optional `sendConfirmation: true`. Without it, membership creation is
unchanged: new and resubscribed memberships start unconfirmed and no mail is sent. With it, Lists
sends one double-opt-in confirmation per sending domain for requested unconfirmed memberships.
An explicit repeat call with `sendConfirmation: true` resends to still-unconfirmed memberships,
including after a provider failure; confirmed memberships never trigger another email. A blocked
subscriber cannot receive a confirmation. A provider failure returns an error and leaves the
membership unconfirmed for retry.

`PUT /campaigns/:id` replaces a draft using the same JSON body as `POST /campaigns`. The campaign
must still be a draft, and the caller must have access to both its current and requested audience.
The operation validates the selected active template and never sends mail. Sent, sending, scheduled,
and failed campaigns cannot be changed through this endpoint.

`GET /subscribers` accepts `listId`, `membershipStatus`, and an email `search` term in addition to
pagination and global status. A list filter returns each subscriber's `membershipStatus`; members
can query only assigned lists. `GET /lists/:id/stats` returns active subscriber counts by membership
status. `POST /subscribers/:id/unsubscribe` takes `{"listId":1,"confirm":true}` and changes only
that list membership; it does not delete the subscriber.

`GET /campaigns/:id/sends` lists actual recipient send records (email, status, attempts, and delivery timestamps) with `limit` and `offset`. It applies the same list access check as campaign detail.

`GET /campaigns/:id/preview` renders HTML and plain text with sample subscriber data. Preview
HTML must be displayed in a sandboxed frame. `POST /campaigns/:id/test-send` takes
`{"subscriberIds":[1,2],"confirm":true}` and sends a separate test copy to 1–20 active, confirmed
members of the campaign's list. The original draft remains unchanged. Both operations respect
list access. Confirmation messages use the selected list's name and default sender address.

## MCP

The stateless Streamable HTTP endpoint is `/mcp/`. It supports `initialize`, `tools/list`, and
`tools/call`, and returns both text and structured tool results. The available tools mirror the
REST operations:

- `lists_list`
- `list_stats`
- `subscribers_list`, `subscriber_get`, `subscriber_create`, `subscriber_unsubscribe`, `subscriber_delete`
- `campaigns_list`, `campaign_get`, `campaign_sends`, `campaign_preview`, `campaign_create_draft`, `campaign_update_draft`, `campaign_send`, `campaign_test_send`
- `deliverability_summary`, `dmarc_summary`
- `email_templates_list`, `email_template_get`, `email_template_create`, `email_template_update`
- `email_template_validate`, `email_template_preview`, `email_template_duplicate`
- `email_template_archive`

## Email template authoring

Templates support complete HTML, MJML, or text-only source. HTML and text alternatives are authored
independently with Handlebars variables, named campaign sections, and template-local partials. MJML is
compiled when a template is created or updated. Templates are mutable: an update validates and replaces
the stored source directly, and campaigns render the current template when they are sent.

Marketing templates must render every required section and an unsubscribe link in each available
alternative. Scripts, event-handler attributes, embedded browsing contexts, dangerous URL schemes,
and non-HTTPS remote assets are rejected. The admin UI at `/admin/templates` is read-only and renders
previews in sandboxed frames; remote assets are blocked unless explicitly enabled for that preview.

Personal access tokens work directly. OAuth clients discover authorization metadata at:

- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-authorization-server`

Register public OAuth clients from `/admin/tokens`. Anonymous dynamic client registration is disabled
by default; it can be enabled deliberately with `OAUTH_DYNAMIC_REGISTRATION_ENABLED=true`.

The OAuth flow supports authorization code with PKCE (`S256`), one-hour access tokens, and refresh
tokens. Authorization uses the existing Lists login and account roles; OAuth does not create a
parallel user system.
