# 4orm candidate

Read the root AGENTS.md and this app's README. Keep 4orm behavior, routes,
storage and tests in this app. Use Remix 3 and explicit Celld bindings. Never
proxy back to Python to conceal missing ported behavior.

This is a review candidate maintained in the primary Harrhy checkout on a
candidate-derived working branch, not an accepted production replacement.
Do not change live Python 4orm, production Auth, or another app's storage. The explicitly
authorized parity review uses sanitized private content copies; keep them ignored
and out of public artifacts. Never import production credentials, sessions or live
queues, or bind either local app writable to production storage. Preserve review
data before replacing an instance. Keep identity mapping exact to issuer/subject
and preserve numeric ownership IDs.

Preserve the Celld-native boundary. Future shared Celld hosting is a direction,
not authorization to merge stores, grants, or app authority. The existing private
review uses a single supervisor and preserved `.review/` state; do not seed or
start a second writer against it. Python source and its `.venv` remain independent
production/oracle dependencies, not cleanup targets.

Run `npm run check --workspace @harrhy/4orm` and the relevant Celld/browser
smokes. Disclose unported behavior and validation limits in the review handoff.
