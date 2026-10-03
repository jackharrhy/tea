# Code quality review — 22 September 2026

The review focused on the monorepo extraction, resource lifetimes, shared presentation contracts, and whether the inherited tests and comments still earn their keep.

## Structural changes

- **Public document ownership:** each design duplicated page-prop types, metadata computation, SEO wiring and preview policy. `PublicDocument` now owns that assembly and uses the shared `PublicPageProps` contract. Templates own their bodies; metadata is computed once. Interactive preview sites remain distinct from static editor previews.
- **Configuration boundary:** `Array.isArray` narrowed JSON to `any[]`, so the old validator accessed unchecked fields and cast template names. A Remix schema now validates each row before domain uniqueness checks. Unknown templates never reach the registry lookup.
- **Database ownership:** adoption used optional database handles plus a destination-ownership flag throughout a large operation. Copying, rebuilding and publishing now have explicit scopes with `finally` cleanup. Row copying uses the existing transaction helper. Startup closes a newly opened database if router construction fails, and initial name/background updates commit together.
- **Canonical traversal:** capability checks reuse the existing block walker instead of defining another recursive walk inside reference validation.

No file crosses the 1,000-line threshold. The larger editor modules remain cohesive owners of editor state; this pass does not split them solely to reduce file length. Open-ended authored block properties remain supported so imports and future metadata survive edits.

## Comment pruning

Removed redundant CSS banners, obvious ownership summaries, an obsolete migration summary, and test-cleanup narration. Kept explanations of HEAD handling, write-lock/history ordering, retained upload bytes, deterministic legacy adornment IDs, TipTap DOM ownership, and preview reconciliation.

## Test pruning

- Removed `database.test.ts`: adoption already initializes and reopens populated databases against the migration journal.
- Removed `content.test.ts`: unknown block properties now round-trip through the existing draft/publish test; the existing concurrent-publication test also checks stale direct saves.

The server suite goes from 24 to 22 tests. No distinct authored-data or stale-write protection was intentionally dropped. Both browser workflows remain; there was no evidence justifying removal of their editor, publication, navigation or Riso checks.

## Tooling and verification

Oxlint correctness/suspicious rules and Oxfmt checks are required locally through `npm run check` and in GitHub Actions. React-specific lint plugins are not enabled for native Remix UI. Tool versions are pinned; generated data and vendored icons are excluded from formatting.

Validation: lint, formatting, typecheck/browser-module build, 22 server tests and both browser workflows. These use generated content and do not modify either existing site or deploy a service.
