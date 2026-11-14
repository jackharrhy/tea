# Harrhy contributor guidance

Harrhy is a Remix 3 monorepo of independently deployable apps and importable packages. The [root README](README.md) lists them. Before editing a workspace, read its README and any local `AGENTS.md`. Keep its README accurate for people and agents: purpose, entry points, setup, checks, and boundaries. Add a README and a root table row for each new workspace.

<!-- prettier-ignore -->
| Location | Responsibility |
| --- | --- |
| `apps/*` | Deployable products: routes, UI, storage, runtime configuration, and presentation |
| `packages/*` | Shared modules and intentionally embeddable runtimes |
| `docs/*` | Architecture and product guides that span individual files |

## Parallel task workflow

Use a separate branch and worktree for each bounded task, starting from freshly fetched `origin/main`. The shared main checkout is not an editing hub. Agents may create their own worktrees, push PRs, and review and merge their own owner-authorized work; no coordinator permission, locks, holds, or central ownership registry is required.

Keep dependencies, generated output, caches, runtime state, and build directories isolated per worktree. Give concurrent servers distinct ports. Do not change another task's checkout. Retry ordinary Git/GitHub races; update or rebase for actual conflicts, integration validation, or GitHub requirements, then rerun affected checks.

Before merging, mark the PR ready, review its diff, run applicable local checks, and verify all expected PR workflows completed successfully on the exact current head. Draft checks have reduced coverage. Do not rely on required-only check queries: required checks are not currently enforced by GitHub. Do not bypass failures or safeguards.

Ask for owner review through Familiar only for a specific unresolved product, security, or destructive decision, with the PR link and reason. Otherwise self-merge within the approved scope and notify Harrhy of the result. Remove finished worktrees once their work is preserved and private state and active users have been checked; never force removal to discard unknown data.

Shared-runtime operations may need serialization by their operator; that does not reserve source files or gate independent source work. No GitHub auto-merge setting or custom status subscription is needed for this workflow.

## Code and workspace conventions

Keep Markdown tables unpadded and put `<!-- prettier-ignore -->` immediately before each table so OxFmt leaves the source easy to edit.

Apps import packages; packages must not import apps. Use Remix 3 for app routing, controllers, middleware, and UI. Read the [Remix skill](.agents/skills/remix/SKILL.md) and relevant installed guides before changing framework behavior. Put Node and Cloudflare runtime rules in the relevant workspace guide.

Use Remix `css(...)` mixins for static UI styles. Keep inline `style` for values computed at runtime. A small stylesheet is fine for CSS features the mixin cannot express, such as `@font-face`.

Keep behavior owned by one app inside that app, even when it has a clean internal interface. Extract a package when another consumer needs it or the module is meant to be embedded by independent hosts.

Prefer interfaces, plain objects, and functions that close over private state. Do not add TypeScript `namespace` declarations or classes just to group functions or state. Use a class only when an external API requires one.

Put tests and test-only fixtures in `__tests__/` beside the code they cover. Put host integration and browser tests in the app's `__tests__/`. Do not use a root `tests/` directory or put `*.test.*` and `*.spec.*` beside implementation files. Keep those suffixes inside `__tests__/` for discovery. Production code must not import tests.

Run checks for each affected workspace and its consumers when a package interface changes. Keep Dockerfiles with their apps; add containerized apps to root `compose.yml`. Host configuration, DNS, secrets, and production operations live in another repo.

Give each new app or independently checked package a `check` script in its workspace manifest. CI discovers it, follows workspace dependencies, and runs affected checks after one install. Add app-specific CI steps only when its check needs external setup.
