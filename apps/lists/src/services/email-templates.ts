import Handlebars from "handlebars";
import mjml2html from "mjml";
import { Parser } from "htmlparser2";
import { htmlToText } from "html-to-text";
import { marked } from "marked";
import { eq } from "drizzle-orm";
import type { Db } from "../db";
import * as schema from "../db/schema";

export type TemplateSection = {
  key: string;
  name: string;
  format: "markdown" | "html" | "text";
  required: boolean;
};

export type TemplateSource = {
  sourceFormat: "html" | "mjml" | "text";
  subjectSource?: string | null;
  htmlSource?: string | null;
  textSource: string;
  sections: TemplateSection[];
  partials: Record<string, string>;
};

export type TemplateRenderContext = {
  subscriber: {
    email: string;
    firstName?: string | null;
    lastName?: string | null;
  };
  campaign: { subject: string };
  list: { name: string; slug?: string };
  links: { unsubscribe: string; preferences: string };
  sectionSources: Record<string, string>;
};

export class TemplateValidationError extends Error {
  status = 400;
  constructor(public issues: string[]) {
    super(issues.join("; "));
  }
}

const MAX_RENDERED_BYTES = 10_000_000;

const BUILT_IN_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>{{campaign.subject}}</title></head>
<body style="background:#fff;color:#202020;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0">
  <div style="margin:0 auto;padding:40px 24px 32px;max-width:580px">
    <div style="border-bottom:1px solid #dedede;color:#202020;font-size:16px;font-weight:600;line-height:22px;margin:0 0 32px;padding:0 0 16px">{{list.name}}</div>
    <div style="color:#202020;font-size:16px;line-height:1.65">{{{sections.content.html}}}</div>
    <hr style="border:0;border-top:1px solid #dedede;margin:40px 0 18px">
    <p style="color:#737373;font-size:13px;line-height:20px;margin:0"><a href="{{links.preferences}}" style="color:#5c5c5c;text-decoration:underline">Manage preferences</a>&nbsp;&nbsp;&nbsp;<a href="{{links.unsubscribe}}" style="color:#5c5c5c;text-decoration:underline">Unsubscribe</a></p>
  </div>
</body></html>`;
const BUILT_IN_TEXT = `{{sections.content.text}}\n\nUnsubscribe: {{links.unsubscribe}}\nManage preferences: {{links.preferences}}`;

export function seedBuiltInTemplates(db: Db) {
  const existing = db
    .select()
    .from(schema.emailTemplates)
    .where(eq(schema.emailTemplates.slug, "newsletter"))
    .get();
  if (existing) return existing;
  const now = new Date().toISOString();
  return db
    .insert(schema.emailTemplates)
    .values({
      slug: "newsletter",
      name: "Newsletter",
      description: "The original minimal Lists newsletter.",
      status: "active",
      builtIn: true,
      createdAt: now,
      updatedAt: now,
      sourceFormat: "html",
      htmlSource: BUILT_IN_HTML,
      textSource: BUILT_IN_TEXT,
      compiledHtml: BUILT_IN_HTML,
      sections: JSON.stringify([
        { key: "content", name: "Content", format: "markdown", required: true },
      ]),
      partials: "{}",
    })
    .returning()
    .get();
}

function validateHtml(source: string, label: string): string[] {
  const issues: string[] = [];
  const forbiddenTags = new Set([
    "script",
    "iframe",
    "object",
    "embed",
    "form",
    "base",
  ]);
  const parser = new Parser({
    onopentag(name, attributes) {
      if (forbiddenTags.has(name.toLowerCase()))
        issues.push(`${label} contains forbidden <${name}>`);
      if (
        name.toLowerCase() === "meta" &&
        attributes["http-equiv"]?.toLowerCase() === "refresh"
      )
        issues.push(`${label} contains a meta refresh`);
      for (const [attribute, value] of Object.entries(attributes)) {
        if (attribute.toLowerCase().startsWith("on"))
          issues.push(`${label} contains event handler ${attribute}`);
        if (
          ["src", "background"].includes(attribute.toLowerCase()) &&
          value &&
          !/^(https:|data:image\/|cid:|\{\{)/i.test(value)
        ) {
          issues.push(`${label} asset URLs must use HTTPS, data:image, or cid`);
        }
        if (
          attribute.toLowerCase() === "href" &&
          value &&
          !/^(https?:|mailto:|#|\{\{)/i.test(value)
        ) {
          issues.push(`${label} contains an unsafe link protocol`);
        }
        if (
          name.toLowerCase() === "link" &&
          attribute.toLowerCase() === "href" &&
          value &&
          !/^(https:|\{\{)/i.test(value)
        ) {
          issues.push(`${label} linked assets must use HTTPS`);
        }
        if (
          attribute.toLowerCase() === "srcset" &&
          value
            .split(",")
            .some(
              (candidate) =>
                !/^(https:|data:image\/|cid:|\{\{)/i.test(candidate.trim()),
            )
        ) {
          issues.push(
            `${label} srcset assets must use HTTPS, data:image, or cid`,
          );
        }
      }
    },
  });
  parser.write(source);
  parser.end();
  if (/javascript\s*:|vbscript\s*:|expression\s*\(/i.test(source))
    issues.push(`${label} contains executable CSS or a dangerous URL`);
  for (const match of source.matchAll(/url\(\s*['"]?([^)'"\s]+)/gi)) {
    const url = match[1] ?? "";
    if (!/^(https:|data:image\/|cid:|\{\{)/i.test(url))
      issues.push(`${label} CSS asset URLs must use HTTPS, data:image, or cid`);
  }
  for (const match of source.matchAll(
    /@import\s+(?:url\()?['"]?([^)'";\s]+)/gi,
  )) {
    if (!/^(https:|\{\{)/i.test(match[1] ?? ""))
      issues.push(`${label} imported stylesheets must use HTTPS`);
  }
  return [...new Set(issues)];
}

function partialReferences(source: string) {
  return [...source.matchAll(/\{\{>\s*([a-z][a-z0-9_-]*)\b/gi)].map(
    (match) => match[1]!,
  );
}

function validatePartials(
  html: string | null,
  text: string,
  partials: Record<string, string>,
) {
  const issues: string[] = [];
  const names = new Set(Object.keys(partials));
  const sources = [html ?? "", text, ...Object.values(partials)];
  if (sources.some((source) => /\{\{>\s*\(/.test(source)))
    issues.push("Dynamic partial names are not supported");
  for (const reference of sources.flatMap(partialReferences)) {
    if (!names.has(reference)) issues.push(`Unknown partial: ${reference}`);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (name: string, path: string[]) => {
    if (visiting.has(name)) {
      issues.push(`Recursive partial chain: ${[...path, name].join(" -> ")}`);
      return;
    }
    if (visited.has(name)) return;
    visiting.add(name);
    for (const reference of partialReferences(partials[name] ?? ""))
      visit(reference, [...path, name]);
    visiting.delete(name);
    visited.add(name);
  };
  for (const name of names) visit(name, []);
  return issues;
}

export async function compileTemplate(source: TemplateSource) {
  const issues: string[] = [];
  if (source.subjectSource && /\r|\n/.test(source.subjectSource)) {
    issues.push("Subject source cannot contain line breaks");
  }
  const keys = new Set<string>();
  for (const section of source.sections) {
    if (!/^[a-z][a-z0-9_-]*$/.test(section.key))
      issues.push(`Invalid section key: ${section.key}`);
    if (keys.has(section.key))
      issues.push(`Duplicate section key: ${section.key}`);
    keys.add(section.key);
  }
  let compiledHtml: string | null = null;
  if (source.sourceFormat === "text") {
    if (source.htmlSource)
      issues.push("Text-only templates cannot contain HTML source");
  } else if (!source.htmlSource?.trim()) {
    issues.push(`${source.sourceFormat.toUpperCase()} source is required`);
  } else if (source.sourceFormat === "mjml") {
    if (/<mj-include\b/i.test(source.htmlSource))
      issues.push(
        "MJML includes are not supported; use stored partials instead",
      );
    try {
      const result = await mjml2html(source.htmlSource, {
        validationLevel: "strict",
        ignoreIncludes: true,
      });
      compiledHtml = result.html;
    } catch (error) {
      issues.push(
        `MJML compilation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else {
    compiledHtml = source.htmlSource;
  }
  if (!source.textSource.trim()) issues.push("Text source is required");
  if (compiledHtml) issues.push(...validateHtml(compiledHtml, "HTML"));
  for (const [name, partial] of Object.entries(source.partials)) {
    if (!/^[a-z][a-z0-9_-]*$/.test(name))
      issues.push(`Invalid partial name: ${name}`);
    issues.push(...validateHtml(partial, `Partial ${name}`));
  }
  issues.push(
    ...validatePartials(compiledHtml, source.textSource, source.partials),
  );
  if (!source.textSource.includes("links.unsubscribe"))
    issues.push("Text source must reference links.unsubscribe");
  if (compiledHtml && !compiledHtml.includes("links.unsubscribe"))
    issues.push("HTML source must reference links.unsubscribe");
  for (const section of source.sections.filter((item) => item.required)) {
    if (!source.textSource.includes(`sections.${section.key}.`))
      issues.push(
        `Required section ${section.key} is not rendered in text source`,
      );
    if (compiledHtml && !compiledHtml.includes(`sections.${section.key}.`))
      issues.push(
        `Required section ${section.key} is not rendered in HTML source`,
      );
  }
  try {
    if (compiledHtml) Handlebars.precompile(compiledHtml, { strict: true });
    Handlebars.precompile(source.textSource, { strict: true });
    if (source.subjectSource)
      Handlebars.precompile(source.subjectSource, { strict: true });
    for (const partial of Object.values(source.partials))
      Handlebars.precompile(partial, { strict: true });
  } catch (error) {
    issues.push(
      `Handlebars compilation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (issues.length) throw new TemplateValidationError([...new Set(issues)]);
  return { compiledHtml };
}

function templateRuntime(partials: Record<string, string>) {
  const runtime = Handlebars.create();
  runtime.registerHelper("eq", (left, right) => left === right);
  runtime.registerHelper("uppercase", (value) =>
    String(value ?? "").toUpperCase(),
  );
  runtime.registerHelper("lowercase", (value) =>
    String(value ?? "").toLowerCase(),
  );
  runtime.registerHelper("urlencode", (value) =>
    encodeURIComponent(String(value ?? "")),
  );
  for (const [name, source] of Object.entries(partials))
    runtime.registerPartial(name, source);
  return runtime;
}

export async function renderTemplate(
  template: typeof schema.emailTemplates.$inferSelect,
  context: TemplateRenderContext,
) {
  const definitions = JSON.parse(template.sections) as TemplateSection[];
  const partials = JSON.parse(template.partials) as Record<string, string>;
  const base = {
    subscriber: context.subscriber,
    campaign: context.campaign,
    list: context.list,
    links: context.links,
    firstName: context.subscriber.firstName,
    lastName: context.subscriber.lastName,
    email: context.subscriber.email,
    unsubscribeUrl: context.links.unsubscribe,
    preferencesUrl: context.links.preferences,
  };
  const sections: Record<
    string,
    { source: string; html: string; text: string }
  > = {};
  for (const definition of definitions) {
    const raw = context.sectionSources[definition.key] ?? "";
    if (definition.required && !raw.trim())
      throw new TemplateValidationError([
        `Section ${definition.key} is required`,
      ]);
    const rendered = templateRuntime({}).compile(raw)(base);
    const html =
      definition.format === "markdown"
        ? await marked(rendered)
        : definition.format === "html"
          ? rendered
          : "";
    if (html) {
      const issues = validateHtml(html, `Section ${definition.key}`);
      if (issues.length) throw new TemplateValidationError(issues);
    }
    const text =
      definition.format === "markdown"
        ? htmlToText(html)
        : definition.format === "html"
          ? htmlToText(rendered)
          : rendered;
    sections[definition.key] = { source: raw, html, text };
  }
  const data = { ...base, sections };
  const runtime = templateRuntime(partials);
  const subject = template.subjectSource
    ? runtime.compile(template.subjectSource)(data)
    : context.campaign.subject;
  if (/\r|\n/.test(subject))
    throw new TemplateValidationError([
      "Rendered subjects cannot contain line breaks",
    ]);
  if (subject.length > 998)
    throw new TemplateValidationError([
      "Rendered subjects cannot exceed 998 characters",
    ]);
  const result = {
    subject,
    html: template.compiledHtml
      ? runtime.compile(template.compiledHtml)(data)
      : null,
    text: runtime.compile(template.textSource)(data),
  };
  if ((result.html?.length ?? 0) + result.text.length > MAX_RENDERED_BYTES) {
    throw new TemplateValidationError([
      "Rendered email exceeds the 10 MB template limit",
    ]);
  }
  return result;
}
