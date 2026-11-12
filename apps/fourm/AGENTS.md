# 4orm candidate

Read the root AGENTS.md and this app's README. Keep 4orm behavior, routes,
storage and tests in this app. Use Remix 3 and explicit Celld bindings. Never
proxy back to Python to conceal missing ported behavior.

This is an independent review candidate. Do not change live 4orm, production
Auth, the Harrhy owner's checkout, or another app's storage. `.review/` is
disposable fixture state; production data and credentials must not enter it.
Keep identity mapping exact to issuer/subject and preserve numeric ownership IDs.

Run `npm run check --workspace @harrhy/fourm` and the relevant Celld/browser
smokes. Disclose unported behavior and validation limits in the review handoff.
