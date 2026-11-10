import { eq } from "drizzle-orm";
import { schema } from "../db";
import { assertScope, AccessDeniedError } from "../services/access";
import {
  compileTemplate,
  renderTemplate,
  type TemplateSource,
} from "../services/email-templates";
import type { OperationContext } from ".";
import { InvalidOperationError, NotFoundError } from ".";

function assertTemplateAuthor(ctx: OperationContext) {
  assertScope(ctx.principal, "templates:write");
  if (ctx.principal.role === "member")
    throw new AccessDeniedError("Only owners and admins can author templates");
}

function findTemplate(ctx: OperationContext, slug: string) {
  const template = ctx.db
    .select()
    .from(schema.emailTemplates)
    .where(eq(schema.emailTemplates.slug, slug))
    .get();
  if (!template) throw new NotFoundError("Template not found");
  return template;
}

function templateOutput(template: typeof schema.emailTemplates.$inferSelect) {
  return {
    ...template,
    sections: JSON.parse(template.sections) as TemplateSource["sections"],
    partials: JSON.parse(template.partials) as TemplateSource["partials"],
  };
}

function sourceValues(source: TemplateSource, compiledHtml: string | null) {
  return {
    sourceFormat: source.sourceFormat,
    subjectSource: source.subjectSource ?? null,
    htmlSource: source.htmlSource ?? null,
    textSource: source.textSource,
    compiledHtml,
    sections: JSON.stringify(source.sections),
    partials: JSON.stringify(source.partials),
  };
}

export function listTemplates(ctx: OperationContext) {
  assertScope(ctx.principal, "templates:read");
  return ctx.db
    .select({
      id: schema.emailTemplates.id,
      slug: schema.emailTemplates.slug,
      name: schema.emailTemplates.name,
      description: schema.emailTemplates.description,
      status: schema.emailTemplates.status,
      builtIn: schema.emailTemplates.builtIn,
      createdAt: schema.emailTemplates.createdAt,
      updatedAt: schema.emailTemplates.updatedAt,
    })
    .from(schema.emailTemplates)
    .orderBy(schema.emailTemplates.name)
    .all();
}

export function getTemplate(ctx: OperationContext, slug: string) {
  assertScope(ctx.principal, "templates:read");
  return templateOutput(findTemplate(ctx, slug));
}

export async function createTemplate(
  ctx: OperationContext,
  input: TemplateSource & {
    slug: string;
    name: string;
    description?: string | null;
  },
) {
  assertTemplateAuthor(ctx);
  if (
    ctx.db
      .select({ id: schema.emailTemplates.id })
      .from(schema.emailTemplates)
      .where(eq(schema.emailTemplates.slug, input.slug))
      .get()
  ) {
    throw new InvalidOperationError("Template slug already exists");
  }
  const { slug, name, description, ...source } = input;
  const { compiledHtml } = await compileTemplate(source);
  const now = new Date().toISOString();
  return templateOutput(
    ctx.db
      .insert(schema.emailTemplates)
      .values({
        slug,
        name,
        description: description ?? null,
        status: "active",
        ...sourceValues(source, compiledHtml),
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get(),
  );
}

export async function updateTemplate(
  ctx: OperationContext,
  input: TemplateSource & {
    slug: string;
    name?: string;
    description?: string | null;
  },
) {
  assertTemplateAuthor(ctx);
  const template = findTemplate(ctx, input.slug);
  const { slug: _slug, name, description, ...source } = input;
  const { compiledHtml } = await compileTemplate(source);
  const updated = ctx.db
    .update(schema.emailTemplates)
    .set({
      ...sourceValues(source, compiledHtml),
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      status: "active",
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.emailTemplates.id, template.id))
    .returning()
    .get();
  return templateOutput(updated);
}

export function archiveTemplate(
  ctx: OperationContext,
  slug: string,
  confirm: boolean,
) {
  assertTemplateAuthor(ctx);
  if (!confirm)
    throw new InvalidOperationError("Archival requires confirm=true");
  const template = findTemplate(ctx, slug);
  if (template.builtIn)
    throw new InvalidOperationError("Built-in templates cannot be archived");
  return templateOutput(
    ctx.db
      .update(schema.emailTemplates)
      .set({ status: "archived", updatedAt: new Date().toISOString() })
      .where(eq(schema.emailTemplates.id, template.id))
      .returning()
      .get(),
  );
}

export async function previewTemplate(
  ctx: OperationContext,
  slug: string,
  sectionSources: Record<string, string>,
) {
  assertScope(ctx.principal, "templates:read");
  const template = findTemplate(ctx, slug);
  const definitions = JSON.parse(
    template.sections,
  ) as TemplateSource["sections"];
  const samples = Object.fromEntries(
    definitions.map((section) => [
      section.key,
      sectionSources[section.key] ?? `Sample ${section.name} content.`,
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
    sectionSources: samples,
  });
  return {
    ...rendered,
    previewUrl: `${ctx.config.baseUrl}/admin/templates/${encodeURIComponent(slug)}/preview`,
  };
}

export async function validateTemplateSource(
  ctx: OperationContext,
  source: TemplateSource,
) {
  assertTemplateAuthor(ctx);
  const compiled = await compileTemplate(source);
  return { valid: true as const, compiledHtml: compiled.compiledHtml };
}

export async function duplicateTemplate(
  ctx: OperationContext,
  slug: string,
  newSlug: string,
  newName?: string,
) {
  assertTemplateAuthor(ctx);
  const template = findTemplate(ctx, slug);
  return createTemplate(ctx, {
    slug: newSlug,
    name: newName ?? `${template.name} copy`,
    description: template.description,
    sourceFormat: template.sourceFormat,
    subjectSource: template.subjectSource,
    htmlSource: template.htmlSource,
    textSource: template.textSource,
    sections: JSON.parse(template.sections),
    partials: JSON.parse(template.partials),
  });
}
