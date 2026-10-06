# Tea contributor guidance

Tea is a Remix 3 monorepo of independently deployable apps and importable packages. The [root README](README.md) lists them. Before editing a workspace, read its README and any local `AGENTS.md`. Keep its README accurate for people and agents: purpose, entry points, setup, checks, and boundaries. Add a README and a root table row for each new workspace.

<!-- prettier-ignore -->
| Location | Responsibility |
| --- | --- |
| `apps/*` | Deployable products: routes, UI, storage, runtime configuration, and presentation |
| `packages/*` | Shared modules and intentionally embeddable runtimes |
| `docs/*` | Architecture and product guides that span individual files |

Keep Markdown tables unpadded and put `<!-- prettier-ignore -->` immediately before each table so OxFmt leaves the source easy to edit.

Apps import packages; packages must not import apps. Use Remix 3 for app routing, controllers, middleware, and UI. Read the [Remix skill](.agents/skills/remix/SKILL.md) and relevant installed guides before changing framework behavior. Put Node and Cloudflare runtime rules in the relevant workspace guide.

Keep behavior owned by one app inside that app, even when it has a clean internal interface. Extract a package when another consumer needs it or the module is meant to be embedded by independent hosts.

Put tests and test-only fixtures in `__tests__/` beside the code they cover. Put host integration and browser tests in the app's `__tests__/`. Do not use a root `tests/` directory or put `*.test.*` and `*.spec.*` beside implementation files. Keep those suffixes inside `__tests__/` for discovery. Production code must not import tests.

Run checks for each affected workspace and its consumers when a package interface changes. Keep Dockerfiles with their apps; add containerized apps to root `compose.yml`. Host configuration, DNS, secrets, and production operations live in another repo.

For a new app or independently checked package, add a job to `.github/workflows/check.yml` and route changes to it in `scripts/ci/affected.mjs`. The selector follows dependencies in workspace manifests.
