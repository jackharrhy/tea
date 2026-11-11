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

npm requires a package to exist before a trusted publisher can be configured.
After the repository rename and the source is on `main`, an `@harrhy` npm
maintainer with an authenticated npm CLI must publish each new package once:

```sh
npm run check --workspace @harrhy/worldview-renderer
npm run build --workspace @harrhy/worldview-renderer
npm publish --workspace @harrhy/worldview-renderer --access public

npm run check --workspace @harrhy/artbin
npm run build --workspace @harrhy/artbin
npm publish --workspace @harrhy/artbin --access public
```

Then configure a trusted publisher separately in each npm package's settings:
GitHub Actions, owner `jackharrhy`, repository `harrhy`, workflow filename
`publish-npm.yml`, no environment, with direct `npm publish` allowed. A new
trusted publisher must complete its first successful publish within two days,
so configure it when the next package version is ready. The already published
version cannot be published again.

For later versions, run the **Publish npm package** workflow manually on `main`,
selecting one package at a time. It installs from the lockfile, runs repository
tooling and the workspace check, builds and inspects the package, then publishes
with npm OIDC and provenance. It has no npm token or automatic main-push
trigger. Check the registry package and a clean install before directing new
consumers to it. Keep the existing `@jackharrhy/tea-*` releases available; any
deprecation notice should follow verified replacement installs.

The CLI's local `scripts/publish.mjs` still supports an interactive release
when an npm maintainer has authenticated locally. It refuses a non-main or
dirty release and verifies the packed CLI before publishing.

Container image names remain `ghcr.io/jackharrhy/tea-*` until their separate
host configuration and rollback references are migrated. A GitHub repository
rename does not rename npm packages or container images.
