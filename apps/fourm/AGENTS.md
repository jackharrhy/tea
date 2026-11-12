# 4orm candidate

Read the root AGENTS.md and this app's README. Keep 4orm behavior, routes,
storage and tests in this app. Use Remix 3 and explicit Celld bindings. Never
proxy back to Python to conceal missing ported behavior.

This is an independent review candidate. Do not change live 4orm, production
Auth, the Harrhy owner's checkout, or another app's storage. The explicitly
authorized parity review uses sanitized private content copies; keep them ignored
and out of public artifacts. Never import production credentials, sessions or live
queues, or bind either local app writable to production storage. Preserve review
data before replacing an instance. Keep identity mapping exact to issuer/subject
and preserve numeric ownership IDs.

Run `npm run check --workspace @harrhy/fourm` and the relevant Celld/browser
smokes. Disclose unported behavior and validation limits in the review handoff.
