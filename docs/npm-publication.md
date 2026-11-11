# npm packages

The `@harrhy` npm organization is the intended namespace for this monorepo. Two
workspaces are public packages:

<!-- prettier-ignore -->
| Workspace | npm package | Existing package |
| --- | --- | --- |
| `packages/maps-renderer` | `@harrhy/worldview-renderer` | `@jackharrhy/tea-maps-renderer` |
| `apps/artbin-cli` | `@harrhy/artbin` | `@jackharrhy/tea-artbin` |

The root and all other workspaces are private. Their `@harrhy/*` names identify
local workspace dependencies; they are not npm releases. Existing public package
names stay installable while consumers move to the new names.

## First publication

The maintainer must configure a trusted publisher separately for each new npm
package. Use GitHub Actions, GitHub owner `jackharrhy`, repository `harrhy`,
workflow filename `publish-npm.yml`, no environment, and allow direct
`npm publish`. Do this after the repository rename and the workflow are on
`main`. npm requires a new trusted publisher to complete its first successful
publish within two days.

Run the **Publish npm package** workflow manually on `main`, selecting one
package at a time. It installs from the lockfile, runs repository tooling and
the workspace check, builds and inspects the package, then publishes with npm
OIDC and provenance. It has no npm token or automatic main-push trigger.
Check the resulting registry package and a clean install before directing new
consumers to it. Keep the existing `@jackharrhy/tea-*` releases available; any
deprecation notice should follow verified replacement installs.

The CLI's local `scripts/publish.mjs` still supports an interactive release
when an npm maintainer has authenticated locally. It refuses a non-main or
dirty release and verifies the packed CLI before publishing.

Container image names remain `ghcr.io/jackharrhy/tea-*` until their separate
host configuration and rollback references are migrated. A GitHub repository
rename does not rename npm packages or container images.
