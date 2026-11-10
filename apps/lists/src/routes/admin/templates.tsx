/** @jsxRuntime classic */
/** @jsx Html.createElement */
/** @jsxFrag Html.Fragment */
import { eq } from "drizzle-orm";
// oxlint-disable-next-line no-unused-vars -- Html is the classic JSX factory.
import { Html } from "@elysia/html";
import { z } from "zod";
import type { App } from "../../http";
import type { Db } from "../../db";
import { schema } from "../../db";
import {
  renderTemplate,
  type TemplateSection,
} from "../../services/email-templates";
import { highlightTemplateSource } from "../../services/source-highlighter";
import type { User } from "./layout";
import { TemplateGalleryPage, TemplateWorkspacePage } from "./template-views";

const slugParams = z.object({ slug: z.string().min(1) });
const previewQuery = z.object({
  remote: z.enum(["0", "1"]).default("0"),
  mode: z.enum(["html", "text"]).default("html"),
});

function findTemplate(db: Db, slug: string) {
  return db
    .select()
    .from(schema.emailTemplates)
    .where(eq(schema.emailTemplates.slug, slug))
    .get();
}

function textDocument(text: string) {
  const escaped = text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return `<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:28px;font:14px/1.6 ui-monospace,monospace;color:#222}pre{white-space:pre-wrap}</style><pre>${escaped}</pre>`;
}

export function mountTemplateRoutes(app: App, db: Db) {
  app.get("/templates", (c) =>
    c.html(
      <TemplateGalleryPage
        user={c.user as User}
        templates={db
          .select()
          .from(schema.emailTemplates)
          .orderBy(schema.emailTemplates.name)
          .all()}
      />,
    ),
  );

  app.get(
    "/templates/:slug",
    async (c) => {
      const template = findTemplate(db, c.params.slug);
      if (!template) return c.notFound();
      const partials = JSON.parse(template.partials) as Record<string, string>;
      const [html, text, highlightedPartials] = await Promise.all([
        highlightTemplateSource(template.htmlSource, template.sourceFormat),
        highlightTemplateSource(template.textSource, "text"),
        Promise.all(
          Object.entries(partials).map(
            async ([name, source]) =>
              [name, await highlightTemplateSource(source, "html")] as const,
          ),
        ),
      ]);
      return c.html(
        <TemplateWorkspacePage
          user={c.user as User}
          template={template}
          sources={{
            html,
            text,
            partials: Object.fromEntries(highlightedPartials),
          }}
        />,
      );
    },
    { params: slugParams },
  );

  app.get(
    "/templates/:slug/preview",
    async (c) => {
      const template = findTemplate(db, c.params.slug);
      if (!template) return c.notFound();
      const definitions = JSON.parse(template.sections) as TemplateSection[];
      const sectionSources = Object.fromEntries(
        definitions.map((section) => [
          section.key,
          section.format === "html"
            ? `<h1>${section.name}</h1><p>A representative HTML section with <strong>sample content</strong>.</p>`
            : section.format === "markdown"
              ? `# ${section.name}\n\nA representative section rendered with **sample content**.`
              : `${section.name}\n\nA representative plain-text section.`,
        ]),
      );
      const rendered = await renderTemplate(template, {
        subscriber: {
          email: "reader@example.com",
          firstName: "Jane",
          lastName: "Doe",
        },
        campaign: { subject: "Template preview" },
        list: { name: "Example Newsletter", slug: "example" },
        links: { unsubscribe: "#unsubscribe", preferences: "#preferences" },
        sectionSources,
      });
      const body =
        c.query.mode === "text" || !rendered.html
          ? textDocument(rendered.text)
          : rendered.html;
      const assets =
        c.query.remote === "1"
          ? "style-src 'unsafe-inline' https:; img-src https: data: cid:; font-src https: data:;"
          : "style-src 'unsafe-inline'; img-src data: cid:; font-src data:;";
      return new Response(body, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": `default-src 'none'; ${assets}`,
        },
      });
    },
    { params: slugParams, query: previewQuery },
  );
}
