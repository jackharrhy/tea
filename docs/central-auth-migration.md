# Central Auth migration

Tea apps keep their own data and authorization rules. Central Auth proves a
person or service identity; it does not turn a project grant into permission to
edit every document or site. Each app uses a dedicated project audience and an
exact registered callback. Apps keep short-lived, revocable local sessions.

<!-- prettier-ignore -->
| App | Current credential | Central boundary | Local authorization to preserve |
| --- | --- | --- | --- |
| Letters to Steve | Shared Basic password | Public PKCE browser client at `steve-letter-writ.ing/auth/callback` | One reviewed owner subject with app admin role; private inbox and attachments |
| Ref | Shared password | Public PKCE browser client at `ref.jackharrhy.dev/auth/callback` | Every approved member can use the existing shared boards; board and asset IDs stay stable |
| Radio | Shared password | Public PKCE browser client at `radio.jackharrhy.dev/auth/callback` | Every approved member can use the existing shared rooms; chosen display name is cosmetic |
| Marky | Discord guild OAuth | Public PKCE browser client at `md.jackharrhy.dev/auth/callback` | Explicit Central Auth membership grants replace the live guild check; Markdown and Yjs state stay stable |
| CMS | Operator and site passwords, static MCP token | Three public PKCE browser clients and human-admin MCP resource credentials | Operator, Andrew editor, and Luke editor permissions remain separate; site content IDs stay stable |
| CMS Edge | Prototype password and preview bearer | Worker-compatible PKCE editor client and introspected human-admin preview API | Reviewed owner subject and project admin grant; no production cutover until the prototype has a real host and preview consumer contract |
| Gurgur admin reset | Static admin token | Remove production-only test control; retain local test harness token | Production has no reset route or admin credential; player sessions are separate |

Artbin, Lists, and Maps already use `@tea/identity`. Burger and Pool use Central
Auth with app-owned OIDC code; consolidating those clients into the shared
identity package is a separate code cleanup after their existing contracts are
verified. Pool guests and spectators remain supported.

## Cutover order

1. Stage each Auth project/client and exact roles without activating a public
   login. Review any existing local identity link from immutable subject evidence;
   never infer a link from a display name, email address, Discord name, or the
   shared password.
2. Run the new source against disposable app data and real Auth tokens. Cover
   successful sign-in, wrong project/role/subject, logout, and the app's protected
   browser/API/WebSocket routes. Keep production data and old credentials live.
3. Publish and select the app image with its new Auth configuration. Verify local
   data IDs and actual public browser access. Remove old credential references,
   disable old clients or tokens, and retire the old path only after that app's
   acceptance. Preserve the normal current-data rollback point.

Auth owns project/client/grant creation. Tea owns app source and app acceptance.
Infra owns production secrets, routing, and image selection. A published Tea
image is not evidence that an Auth client or live deployment has changed.
