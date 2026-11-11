import { eq } from "drizzle-orm";
import { css, type Handle, unsafeHTML } from "remix/component";
import { createController } from "remix/router";

import { schema, type Db } from "../src/db/index.ts";
import {
  renderTemplate,
  type TemplateSection,
} from "../src/services/email-templates.ts";
import { highlightTemplateSource } from "../src/services/source-highlighter.ts";
import { AdminDocument, type Viewer } from "./admin.tsx";
import { routes } from "./routes.ts";

type Template = typeof schema.emailTemplates.$inferSelect;
type User = Pick<typeof schema.users.$inferSelect, "role" | "name" | "email">;
const heading = css({ fontSize: "24px", fontWeight: 700, margin: "0 0 16px" });
const intro = css({
  maxWidth: "640px",
  color: "#4b5563",
  fontSize: "14px",
  lineHeight: 1.6,
});
const templateList = css({ display: "grid", gap: "12px", marginTop: "24px" });
const templateCard = css({
  display: "grid",
  gridTemplateColumns: "160px 1fr",
  gap: "20px",
  padding: "20px",
  border: "1px solid #e5e7eb",
  borderRadius: "8px",
  backgroundColor: "#fff",
  color: "#111827",
  textDecoration: "none",
  "@media (max-width: 640px)": { gridTemplateColumns: "1fr" },
});
const previewFrame = css({
  boxSizing: "border-box",
  width: "100%",
  height: "120px",
  border: "1px solid #e5e7eb",
  borderRadius: "6px",
  backgroundColor: "#fff",
});
const cardTitle = css({ fontSize: "16px", fontWeight: 650, margin: 0 });
const metadata = css({ color: "#6b7280", fontSize: "12px" });
const source = css({
  overflowX: "auto",
  padding: "16px",
  border: "1px solid #e5e7eb",
  borderRadius: "6px",
  backgroundColor: "#f8fafc",
  fontSize: "12px",
  lineHeight: 1.5,
});
const columns = css({
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(300px, 1fr)",
  gap: "20px",
  "@media (max-width: 800px)": { gridTemplateColumns: "1fr" },
});
const workspacePreview = css({
  boxSizing: "border-box",
  width: "100%",
  minHeight: "580px",
  border: "1px solid #e5e7eb",
  borderRadius: "6px",
  backgroundColor: "#fff",
});
const sectionHeading = css({
  fontSize: "17px",
  fontWeight: 600,
  margin: "24px 0 10px",
});
const link = css({ color: "#1d4ed8", textDecoration: "none" });

function viewer(user: User): Viewer {
  return { name: user.name ?? user.email, isAdmin: user.role !== "member" };
}

function Gallery(handle: Handle<{ viewer: Viewer; templates: Template[] }>) {
  return () => (
    <AdminDocument
      title="Email templates"
      activeHref="/admin/templates"
      viewer={handle.props.viewer}
    >
      <h1 mix={heading}>Email templates</h1>
      <p mix={intro}>
        Preview the layouts available to campaigns. Use the API or MCP to create
        and update them.
      </p>
      <div mix={templateList}>
        {handle.props.templates.map((template) => (
          <a
            mix={templateCard}
            href={`/admin/templates/${encodeURIComponent(template.slug)}`}
          >
            <iframe
              mix={previewFrame}
              title={`${template.name} preview`}
              sandbox=""
              tabIndex={-1}
              src={`/admin/templates/${encodeURIComponent(template.slug)}/preview`}
            />
            <div>
              <h2 mix={cardTitle}>{template.name}</h2>
              <p mix={intro}>{template.description || "No description."}</p>
              <p mix={metadata}>
                {template.slug} · {template.status} ·{" "}
                {template.sourceFormat.toUpperCase()}
              </p>
            </div>
          </a>
        ))}
        {handle.props.templates.length === 0 ? (
          <p mix={intro}>No templates yet.</p>
        ) : null}
      </div>
    </AdminDocument>
  );
}

function Workspace(
  handle: Handle<{
    viewer: Viewer;
    template: Template;
    sources: { html: string; text: string; partials: Record<string, string> };
  }>,
) {
  return () => {
    const { template, sources, viewer: account } = handle.props;
    const sections = JSON.parse(template.sections) as TemplateSection[];
    const preview = `/admin/templates/${encodeURIComponent(template.slug)}/preview`;
    return (
      <AdminDocument
        title={template.name}
        activeHref="/admin/templates"
        viewer={account}
      >
        <a mix={link} href="/admin/templates">
          ← All templates
        </a>
        <h1 mix={heading}>{template.name}</h1>
        <p mix={intro}>
          {template.description || "No description."} · {template.status} ·{" "}
          {template.sourceFormat.toUpperCase()} · {sections.length} fields
        </p>
        <div mix={columns}>
          <section>
            <h2 mix={sectionHeading}>Preview</h2>
            <p mix={metadata}>
              <a mix={link} href={preview}>
                HTML
              </a>{" "}
              ·{" "}
              <a mix={link} href={`${preview}?mode=text`}>
                Plain text
              </a>{" "}
              ·{" "}
              <a mix={link} href={`${preview}?remote=1`}>
                Remote images
              </a>
            </p>
            <iframe
              mix={workspacePreview}
              title="Template preview"
              sandbox=""
              src={preview}
            />
          </section>
          <section>
            <h2 mix={sectionHeading}>HTML source</h2>
            <div mix={source} innerHTML={unsafeHTML(sources.html)} />
            <h2 mix={sectionHeading}>Text source</h2>
            <div mix={source} innerHTML={unsafeHTML(sources.text)} />
            {Object.entries(sources.partials).map(([name, highlighted]) => (
              <div>
                <h2 mix={sectionHeading}>{name}</h2>
                <div mix={source} innerHTML={unsafeHTML(highlighted)} />
              </div>
            ))}
          </section>
        </div>
      </AdminDocument>
    );
  };
}

function textDocument(text: string) {
  const escaped = text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return `<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:28px;font:14px/1.6 ui-monospace,monospace;color:#222}pre{white-space:pre-wrap}</style><pre>${escaped}</pre>`;
}

export function createAdminTemplatesController(db: Db, user: User) {
  function find(slug: string) {
    return db
      .select()
      .from(schema.emailTemplates)
      .where(eq(schema.emailTemplates.slug, slug))
      .get();
  }
  return createController(routes.admin.templates, {
    actions: {
      index(context) {
        const templates = db
          .select()
          .from(schema.emailTemplates)
          .orderBy(schema.emailTemplates.name)
          .all();
        return context.render(
          <Gallery viewer={viewer(user)} templates={templates} />,
        );
      },
      async show(context) {
        const template = find(context.params.slug);
        if (!template) return new Response("Not Found", { status: 404 });
        const partials = JSON.parse(template.partials) as Record<
          string,
          string
        >;
        const [html, text, entries] = await Promise.all([
          highlightTemplateSource(template.htmlSource, template.sourceFormat),
          highlightTemplateSource(template.textSource, "text"),
          Promise.all(
            Object.entries(partials).map(
              async ([name, value]) =>
                [name, await highlightTemplateSource(value, "html")] as const,
            ),
          ),
        ]);
        return context.render(
          <Workspace
            viewer={viewer(user)}
            template={template}
            sources={{ html, text, partials: Object.fromEntries(entries) }}
          />,
        );
      },
      async preview(context) {
        const template = find(context.params.slug);
        if (!template) return new Response("Not Found", { status: 404 });
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
        const query = context.url.searchParams;
        const body =
          query.get("mode") === "text" || !rendered.html
            ? textDocument(rendered.text)
            : rendered.html;
        const assets =
          query.get("remote") === "1"
            ? "style-src 'unsafe-inline' https:; img-src https: data: cid:; font-src https: data:;"
            : "style-src 'unsafe-inline'; img-src data: cid:; font-src data:;";
        return new Response(body, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Security-Policy": `default-src 'none'; ${assets}`,
          },
        });
      },
    },
  });
}
