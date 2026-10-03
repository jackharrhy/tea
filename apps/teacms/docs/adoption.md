# Adopting an existing TeaCMS site

For the two existing local checkouts, stop their preview writers and run this from the TeaCMS repository root:

```sh
npm run tea:adopt-local -- ../andrew-gosse-site ../luke-blackmore-site
```

This command adopts both `data/` directories into ignored `data/andrew` and `data/luke`, copies Andrew's favicon and Luke's favicon, font, license and font-enabled site stylesheet, and publishes both destinations only after both migrations succeed. It refuses to replace either destination. The original checkouts and their data remain untouched. Run it while the source sites are stopped so uploads and database rows form a consistent snapshot. It is a one-time local migration, not a sync command.

Use a consistent backup containing `tea.db` and `uploads/`. Do not point the shared runtime directly at an existing Andrew or Luke database: their original migration baselines differ from this repository's shared baseline.

```sh
npm run tea:adopt -- /path/to/site-backup /path/to/new-data/andrew
```

The destination must not exist. The command opens the source database read-only and takes a SQLite backup snapshot into temporary storage, initializes a fresh shared database, then copies application rows into that schema. It preserves IDs, users/password hashes, published pages, drafts, revision snapshots, navigation, settings, history, folder metadata and adornments. It checks for unrecognized tables/columns, foreign-key violations, database integrity and missing referenced upload files. Unknown data fails the operation rather than being silently discarded.

Original migration journals are replaced by the fresh shared migration history. Existing sessions are omitted, so editors sign in again. Upload files are copied; the source directory remains untouched. Run the command against a consistent offline backup because database snapshotting does not make a concurrently changing uploads directory atomic.

The returned counts are for checking the copy. The command does not configure domains, rewrite links, publish drafts, start servers or deploy anything. Keep the original backup until the migrated site has been reviewed.

Set the corresponding site ID, template, name and canonical origin in the ignored registry and start the server against the new data root. Existing public names/descriptions remain stored in the database. The registry origin is authoritative for metadata and session security.

## Presentation assets

This repository deliberately excludes portraits, backgrounds, score PDFs, recordings, favicon artwork, adornment artwork and site font binaries. The generic social SVG icons retain their CC0 notice. Luke uses a system serif fallback until its font is supplied separately.

Managed media in `uploads/` comes across with the adoption command. Other static site assets need a separate review: place them in ignored `data/<site-id>/public/`, served before the template assets. This directory is operator-managed, separate from CMS uploads. They are not silently bundled into Git. For Luke, restore its original font to `public/fonts/` and its original `site.css` (which declares that font) to this runtime public directory. A font can be reintroduced with a local `@font-face` rule once its separately managed file is available.

Andrew's `api.andrewgossecomposer.com/uploads/` compatibility service is outside TeaCMS. Preserve it until old media references have been migrated and verified. Absolute URLs embedded in content are preserved, including third-party recordings and legacy links.

## Before a future cutover

1. Back up SQLite and uploads consistently and retain the old image/configuration.
2. Adopt into a new, separately mounted directory.
3. Preview both sites with `preview: true`; compare routes, navigation, images, recordings, drafts and optional features.
4. Verify each site's users, sitemap, canonical origin and analytics ID.
5. Change the proxy route only after review. The original service/data remain available for rollback.

No production data was imported while creating this repository, and neither existing site was moved.
