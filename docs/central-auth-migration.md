# Jack Auth migration

Harrhy apps keep their own data and authorization rules. Jack Auth proves a
person or service identity; it does not turn a project grant into permission to
edit every document or site. Each app uses a dedicated project audience and an
exact registered callback. Apps keep short-lived, revocable local sessions.

<!-- prettier-ignore -->
| App | Credential note | Jack Auth boundary | Local authorization to preserve |
| --- | --- | --- | --- |
| Letters to Steve | Shared Basic password | Public PKCE browser client at `steve-letter-writ.ing/auth/callback` | Reviewed Jack admin and Steve recipient subjects; both can work in the inbox, only admin can change site availability |
| Ref | Shared password | Public PKCE browser client and delegated archive resource at `ref.jackharrhy.dev` | Jack alone has initial access; browser boards keep their IDs, archive read requires admin plus `archive-read`, and restore additionally requires `archive-restore` |
| Radio | Jack Auth live | Public PKCE browser client at `radio.jackharrhy.dev/auth/callback` | Eligible Jack Auth users explicitly Join to receive a Radio member grant and can then access the shared rooms; each session records its immutable subject, and the chosen display name is cosmetic |
| Marky | Jack Auth live | Public PKCE browser client at `md.jackharrhy.dev/auth/callback` | Jack alone has initial access; Markdown and Yjs state stay stable |
| CMS | Operator and site passwords, static MCP token | Three public PKCE browser clients and human-admin MCP resource credentials | Jack's reviewed operator link can enter both editors through one-use site-bound tickets; direct Andrew/Luke login waits for explicit local links; content IDs stay stable |
| CMS Edge | Prototype password and preview bearer | Worker-compatible PKCE editor client and introspected human-admin preview API | Reviewed owner subject and project admin grant; no production cutover until the prototype has a real host and preview consumer contract |
| Gurgur admin reset | Static admin token | Remove production-only test control; retain local test harness token | Production has no reset route or admin credential; player sessions are separate |

Artbin, Lists, and Worldview already use `@harrhy/identity`. Burger and Pool use Jack
Auth with app-owned OIDC code; consolidating those clients into the shared
identity package is a separate code cleanup after their existing contracts are
verified. Pool guests and spectators remain supported.

## Cutover order

1. Stage each Auth project/client and exact roles without activating a public
   login. Radio uses an explicit Join flow for eligible Jack Auth users to receive
   member grants. Review any existing local identity link from immutable subject evidence;
   never infer a link from a display name, email address, Discord name, or the
   shared password.
2. Run the new source against disposable app data and real Auth tokens. Cover
   successful sign-in, wrong project/role/subject, logout, and the app's protected
   browser/API/WebSocket routes. Keep production data and old credentials live.
3. Publish and select the app image with its new Auth configuration. Verify local
   data IDs and actual public browser access. Remove old credential references,
   disable old clients or tokens, and retire the old path only after that app's
   acceptance. Preserve the normal current-data rollback point.

Auth owns project/client/grant creation. Harrhy owns app source and app acceptance.
Infra owns production secrets, routing, and image selection. A published Harrhy
image is not evidence that an Auth client or live deployment has changed.
