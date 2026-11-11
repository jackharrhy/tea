# @harrhy/burger-core

Shared Burger ECS components, collision and movement physics, and version 1 network constants and types. The Bun authority and Pixi client both consume this package; it owns no routes, persistence, or UI.

Install from the Tea root with `npm ci`. Run `npm run check --workspace @harrhy/burger-core` for type checking and Bun tests. Keep numeric wire values, component ordering, and input acknowledgement semantics compatible with the existing Burger runtime while migrating.
