import { count, sql, sum } from "drizzle-orm";
import { createController } from "remix/router";
import { redirect } from "remix/response/redirect";
import { css } from "remix/component";

import { files, folders } from "#db";
import { db } from "#db/connection.server";

import { operationCatalog } from "../../../operations/catalog.ts";
import { operationErrorResponse } from "../../../operations/errors.ts";

import { requireAdmin } from "../../../middleware/auth.ts";
import { routes } from "../../../routes.ts";
import { AdminPage } from "../../../ui/admin-page.tsx";
import { formatSize } from "../../../ui/file-collection.tsx";
import {
  Badge,
  Button,
  ButtonLink,
  FormField,
  Panel,
  SectionHeader,
  SelectInput,
  Stat,
  StatGrid,
  TextArea,
  TextInput,
} from "../../../ui/primitives.tsx";
import { theme } from "../../../ui/styles.ts";

const sectionStyle = css({ marginBottom: "2rem" });
const statsCardStyle = css({ marginBottom: "1.5rem" });
const kindStatsStyle = css({
  color: theme.color.muted,
  display: "flex",
  flexWrap: "wrap",
  fontSize: "0.75rem",
  gap: "1rem",
  marginTop: "1rem",
});
const descriptionStyle = css({
  color: theme.color.muted,
  fontSize: "0.875rem",
  margin: "0 0 1rem",
});
const submitStyle = css({ marginTop: "1rem" });
const archiveCardStyle = css({
  alignItems: "center",
  display: "flex",
  gap: "1rem",
  justifyContent: "space-between",
});
const onlineCardStyle = css({
  alignItems: "flex-start",
  display: "flex",
  gap: "1rem",
  justifyContent: "space-between",
  marginBottom: "1rem",
});
const sourceDescriptionStyle = css({
  color: theme.color.muted,
  fontSize: "0.875rem",
  margin: 0,
});

const sources = [
  {
    id: "early-web-graphics",
    name: "Museum of Early Web Graphics",
    description:
      "Andy Baga’s curated clip art, GIFs, bars, and backgrounds; excludes Adult galleries",
    url: "https://andybaga.neocities.org/museum/main",
  },
  {
    id: "katamari",
    name: "Katamari Object Library",
    description:
      "Textured GLB models from Katamari Damacy and We Love Katamari",
    url: "https://katamari.andrew-boylan.com/",
  },
  {
    id: "texturetown",
    name: "TextureTown",
    description: "3,800+ retro game textures from textures.neocities.org",
    url: "https://textures.neocities.org/",
  },
  {
    id: "texture-station",
    name: "Texture Station",
    description: "Classic tiling backgrounds from thejang.com",
    url: "https://thejang.com/textures/",
  },
  {
    id: "sadgrl",
    name: "Sadgrl Tiled Backgrounds",
    description: "Tiled backgrounds organized by color",
    url: "https://sadgrlonline.github.io/archived-sadgrl.online/webmastery/downloads/tiledbgs.html",
  },
] as const;

export default createController(routes.admin.import, {
  middleware: [requireAdmin()],
  actions: {
    async index(context) {
      if (!context.user) return redirect(routes.login.href(), 303);
      const [[fileStats], [folderStats], byKind, destinationFolders] =
        await Promise.all([
          db.select({ count: count(), size: sum(files.size) }).from(files),
          db.select({ count: count() }).from(folders),
          db
            .select({ kind: files.kind, size: sum(files.size), count: count() })
            .from(files)
            .groupBy(files.kind),
          db.query.folders.findMany({
            where: sql`substr(${folders.slug}, 1, 1) <> '_'`,
            orderBy: (table, { asc }) => [asc(table.slug)],
          }),
        ]);

      return context.render(
        <AdminPage user={context.user} active="import" title="Import">
          <section mix={statsCardStyle}>
            <SectionHeader title="Current stats" />
            <Panel>
              <StatGrid>
                <Stat label="Total files" value={fileStats?.count ?? 0} />
                <Stat
                  label="Total size"
                  value={formatSize(Number(fileStats?.size) || 0)}
                />
                <Stat label="Total folders" value={folderStats?.count ?? 0} />
              </StatGrid>
              <div mix={kindStatsStyle}>
                {byKind.map((kind) => (
                  <Badge key={kind.kind}>
                    {kind.kind}: {kind.count} (
                    {formatSize(Number(kind.size) || 0)})
                  </Badge>
                ))}
              </div>
            </Panel>
          </section>

          <section mix={sectionStyle}>
            <SectionHeader title="Import from site" />
            <form method="post" action={routes.admin.import.action.href()}>
              <Panel>
                <input type="hidden" name="intent" value="remote-site-import" />
                <p mix={descriptionStyle}>
                  Paste GameBanana or SCMapDB pages, or direct HTTPS links to
                  ZIP, 7z, and RAR archives. Enter one URL per line, up to 20 at
                  a time.
                </p>
                <FormField label="Source URLs" htmlFor="source-urls" required>
                  <TextArea
                    id="source-urls"
                    name="sourceUrls"
                    rows={5}
                    required
                    fullWidth
                    mono
                    placeholder="https://gamebanana.com/mods/140244"
                  />
                </FormField>
                <FormField label="Destination folder" htmlFor="import-target">
                  <SelectInput
                    id="import-target"
                    name="targetFolderId"
                    fullWidth
                  >
                    <option value="">Top level</option>
                    {destinationFolders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.slug}
                      </option>
                    ))}
                  </SelectInput>
                </FormField>
                <div mix={submitStyle}>
                  <Button type="submit" variant="primary">
                    Queue imports
                  </Button>
                </div>
              </Panel>
            </form>
          </section>

          <section mix={sectionStyle}>
            <SectionHeader title="Local folder" />
            <form method="post" action={routes.admin.import.action.href()}>
              <Panel>
                <input type="hidden" name="intent" value="folder-import" />
                <FormField
                  label="Folder path"
                  htmlFor="local-folder-path"
                  required
                >
                  <TextInput
                    id="local-folder-path"
                    name="folderPath"
                    required
                    fullWidth
                    mono
                  />
                </FormField>
                <FormField
                  label="Collection name"
                  htmlFor="local-folder-name"
                  hint="Optional. Defaults to the folder name."
                >
                  <TextInput
                    id="local-folder-name"
                    name="folderName"
                    fullWidth
                  />
                </FormField>
                <div mix={submitStyle}>
                  <Button type="submit" variant="primary">
                    Import folder
                  </Button>
                </div>
              </Panel>
            </form>
          </section>

          <section mix={sectionStyle}>
            <SectionHeader title="Local archives" />
            <Panel>
              <div mix={archiveCardStyle}>
                <p mix={sourceDescriptionStyle}>
                  Scan and import PAK, PK3, WAD, ZIP, and BSP files on this
                  computer.
                </p>
                <ButtonLink
                  href={routes.admin.archives.index.href()}
                  variant="primary"
                >
                  Browse archives
                </ButtonLink>
              </div>
            </Panel>
          </section>

          <section mix={sectionStyle}>
            <SectionHeader title="Maintenance" />
            <form method="post" action={routes.admin.import.action.href()}>
              <Panel>
                <input
                  type="hidden"
                  name="intent"
                  value="regenerate-previews"
                />
                <p mix={descriptionStyle}>
                  Replace generated file previews, 2048px BSP overviews,
                  navigation data, dependency manifests, and folder preview
                  images from their current sources.
                </p>
                <Button type="submit">Regenerate previews</Button>
              </Panel>
            </form>
          </section>

          <section mix={sectionStyle}>
            <SectionHeader title="Online sources" />
            {sources.map((source) => (
              <form
                key={source.id}
                method="post"
                action={routes.admin.import.action.href()}
              >
                <Panel>
                  <div mix={onlineCardStyle}>
                    <input type="hidden" name="intent" value={source.id} />
                    <div>
                      <h3>
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {source.name}
                        </a>
                      </h3>
                      <p mix={sourceDescriptionStyle}>{source.description}</p>
                    </div>
                    <Button type="submit">Import all</Button>
                  </div>
                </Panel>
              </form>
            ))}
          </section>
        </AdminPage>,
      );
    },

    async action(context) {
      const user = context.user;
      if (!user) return new Response("Unauthorized", { status: 401 });
      const form = await context.request.formData();
      const intent = form.get("intent");
      const source = sources.find((candidate) => candidate.id === intent);

      let queue: () => Promise<unknown>;
      if (intent === "remote-site-import") {
        queue = () =>
          operationCatalog.importQueue.execute(
            { user, channel: "admin" },
            {
              kind: "remote",
              sourceUrls: stringValue(form.get("sourceUrls"))
                .split(/\r?\n/)
                .map((url) => url.trim())
                .filter(Boolean),
              targetFolderId: stringValue(form.get("targetFolderId")) || null,
              confirm: true,
            },
          );
      } else if (intent === "folder-import") {
        queue = () =>
          operationCatalog.importQueue.execute(
            { user, channel: "admin" },
            {
              kind: "folder",
              sourcePath: stringValue(form.get("folderPath")).trim(),
              collectionName:
                stringValue(form.get("folderName")).trim() || undefined,
              confirm: true,
            },
          );
      } else if (intent === "regenerate-previews") {
        queue = () =>
          operationCatalog.previewRegenerate.execute(
            { user, channel: "admin" },
            { target: { scope: "all" }, confirm: true },
          );
      } else if (source) {
        queue = () =>
          operationCatalog.importQueue.execute(
            { user, channel: "admin" },
            { kind: "catalog", source: source.id, confirm: true },
          );
      } else {
        return new Response("Unknown import action", { status: 400 });
      }

      try {
        await queue();
      } catch (error) {
        return operationErrorResponse(error);
      }

      return redirect(routes.admin.jobs.index.href(), 303);
    },
  },
});

function stringValue(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}
