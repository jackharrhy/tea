# Ref workspace guidance

Read this workspace's README and Tea's root AGENTS.md before editing. Ref owns its routes, browser editor, Durable Objects, image storage, archive format, Worker, and Celld container inside `apps/ref`. Do not extract app-only behavior into a package.

Use `remix/component` and Remix `css(...)` mixins for static UI styles. Keep inline styles for board geometry computed at runtime. Keep the generated browser asset manifest aligned with the build script. Tests and fixtures belong in adjacent `__tests__/` directories; host and browser tests belong in `apps/ref/__tests__/`.

Run `npm run ref:check` from Tea's root. For local Wrangler development, copy `.dev.vars.example` to ignored `.dev.vars` and set `REF_PASSWORD`. Celld uses `CELLD_VAR_REF_PASSWORD` or `CELLD_VARS_FILE`. Never commit passwords, board data, images, or `.celld` and `.wrangler` state.

The Tea copy uses a distinct Worker name and bucket while the original Ref deployment remains live. Preserve the `DirectoryCell` and `BoardCell` migrations and the archive compatibility contract. Changing production storage or host routing belongs to a separate verified cutover in the infrastructure repository.
