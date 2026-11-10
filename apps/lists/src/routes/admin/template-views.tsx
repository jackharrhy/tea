/** @jsxRuntime classic */
/** @jsx Html.createElement */
/** @jsxFrag Html.Fragment */
// oxlint-disable-next-line no-unused-vars -- Html is the classic JSX factory.
import { Html } from "@elysia/html";
import type { schema } from "../../db";
import type { TemplateSection } from "../../services/email-templates";
import { AdminLayout, fmtDateTime, type User } from "./layout";
import { Card, PageHeader } from "./ui";

type Template = typeof schema.emailTemplates.$inferSelect;
export type HighlightedTemplateSources = {
  html: string;
  text: string;
  partials: Record<string, string>;
};

function TemplateState({ template }: { template: Template }) {
  return (
    <span
      class={template.status === "active" ? "text-green-700" : "text-gray-500"}
    >
      {template.status}
    </span>
  );
}

function TemplatePreview({ template }: { template: Template }) {
  return (
    <div
      class="h-32 overflow-hidden rounded-lg border border-gray-200 bg-white"
      aria-hidden="true"
    >
      <iframe
        title={`${template.name} preview`}
        sandbox=""
        tabindex="-1"
        src={`/admin/templates/${template.slug}/preview`}
        class="pointer-events-none h-[512px] w-full origin-top-left scale-25 border-0 bg-white"
        style="width:400%;"
      />
    </div>
  );
}

export function TemplateGalleryPage({
  user,
  templates,
}: {
  user: User;
  templates: Template[];
}) {
  return (
    <AdminLayout title="Email templates" user={user}>
      <PageHeader title="Email templates">
        <span class="text-sm font-normal text-gray-500">
          {templates.length} template{templates.length === 1 ? "" : "s"}
        </span>
      </PageHeader>
      <p class="-mt-4 mb-6 max-w-2xl text-sm text-gray-600">
        Preview the layouts available to campaigns. Use MCP or the API to create
        and update them.
      </p>
      {templates.length === 0 ? (
        <Card>
          <p class="m-0 py-5 text-center text-sm text-gray-500">
            No templates yet.
          </p>
        </Card>
      ) : (
        <div class="mb-6 overflow-hidden rounded-lg border border-gray-200 bg-white">
          {templates.map((template) => {
            const sections = JSON.parse(template.sections) as TemplateSection[];
            return (
              <a
                href={`/admin/templates/${template.slug}`}
                class="group grid gap-4 border-b border-gray-200 px-5 py-5 text-inherit no-underline last:border-b-0 md:grid-cols-[12rem_minmax(0,1fr)_auto] md:items-center"
              >
                <TemplatePreview template={template} />
                <div>
                  <h2
                    safe
                    class="m-0 text-base font-semibold text-gray-900 group-hover:text-blue-700"
                  >
                    {template.name}
                  </h2>
                  <p safe class="mb-0 mt-1 text-sm leading-6 text-gray-600">
                    {template.description || "No description."}
                  </p>
                  <code safe class="mt-2 block text-xs text-gray-400">
                    {template.slug}
                  </code>
                </div>
                <dl class="m-0 grid grid-cols-3 gap-x-5 text-xs md:grid-cols-1 md:gap-y-2 md:text-right">
                  <div>
                    <dt class="sr-only">Status</dt>
                    <dd class="m-0">
                      <TemplateState template={template} />
                    </dd>
                  </div>
                  <div>
                    <dt class="sr-only">Format</dt>
                    <dd class="m-0 font-mono uppercase text-gray-500">
                      {template.sourceFormat}
                    </dd>
                  </div>
                  <div>
                    <dt class="sr-only">Fields</dt>
                    <dd class="m-0 text-gray-500">
                      {sections.length} field{sections.length === 1 ? "" : "s"}
                    </dd>
                  </div>
                </dl>
              </a>
            );
          })}
        </div>
      )}
    </AdminLayout>
  );
}

function PreviewButton({
  value,
  children,
  active = false,
}: {
  value: string;
  children: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      data-preview-mode={value}
      aria-pressed={String(active)}
      class={`rounded border border-gray-300 px-2.5 py-1 text-xs ${active ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
    >
      {children}
    </button>
  );
}

export function TemplateWorkspacePage({
  user,
  template,
  sources,
}: {
  user: User;
  template: Template;
  sources: HighlightedTemplateSources;
}) {
  const sections = JSON.parse(template.sections) as TemplateSection[];
  const partials = JSON.parse(template.partials) as Record<string, string>;
  const previewPath = `/admin/templates/${template.slug}/preview`;
  return (
    <AdminLayout title={template.name} user={user}>
      <a
        href="/admin/templates"
        class="text-sm text-gray-500 no-underline hover:text-gray-900"
      >
        ← Email templates
      </a>
      <header class="mb-6 mt-4">
        <PageHeader title={template.name}>
          <dl class="m-0 grid grid-cols-[auto_auto] gap-x-3 gap-y-1 text-xs">
            <dt class="text-gray-400">Status</dt>
            <dd class="m-0 text-right">
              <TemplateState template={template} />
            </dd>
            <dt class="text-gray-400">Format</dt>
            <dd class="m-0 text-right font-mono uppercase text-gray-600">
              {template.sourceFormat}
            </dd>
            <dt class="text-gray-400">Slug</dt>
            <dd safe class="m-0 text-right font-mono text-gray-600">
              {template.slug}
            </dd>
            <dt class="text-gray-400">Updated</dt>
            <dd class="m-0 text-right text-gray-600">
              {fmtDateTime(template.updatedAt)}
            </dd>
          </dl>
        </PageHeader>
        <p safe class="-mt-4 mb-0 max-w-2xl text-sm text-gray-600">
          {template.description || "No description."}
        </p>
      </header>
      <Card>
        <section
          data-template-preview-workspace
          data-preview-base={previewPath}
        >
          <div class="mb-3 flex flex-wrap items-center gap-2">
            <h2 class="mr-2 my-0 text-base font-semibold">Preview</h2>
            <PreviewButton value="html" active>
              HTML
            </PreviewButton>
            <PreviewButton value="text">Text</PreviewButton>
            <span
              class="mx-1 h-5 border-l border-gray-300"
              aria-hidden="true"
            ></span>
            {[375, 600, 800].map((width) => (
              <button
                type="button"
                data-preview-width={String(width)}
                aria-pressed="false"
                class="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50"
              >
                {width} px
              </button>
            ))}
            <button
              type="button"
              data-preview-width="full"
              aria-pressed="true"
              class="rounded border border-gray-900 bg-gray-900 px-2.5 py-1 text-xs text-white"
            >
              Full width
            </button>
            <label class="ml-auto flex cursor-pointer items-center gap-2 text-xs text-gray-600">
              <input type="checkbox" data-preview-remote /> Allow remote images
              and fonts
            </label>
          </div>
          <div class="flex min-h-[680px] justify-center overflow-auto rounded-lg border border-gray-200 bg-gray-100 p-4">
            <iframe
              title={`${template.name} preview`}
              sandbox=""
              data-template-preview-frame
              src={previewPath}
              class="min-h-[640px] w-full rounded bg-white transition-[width]"
            />
          </div>
        </section>
      </Card>
      <Card>
        <section>
          <h2 class="m-0 text-base font-semibold">Campaign fields</h2>
          <p class="mb-4 mt-1 text-sm text-gray-500">
            This template expects these fields from each campaign.
          </p>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-gray-200 text-left text-xs text-gray-500">
                  <th class="py-2 font-medium">Field</th>
                  <th class="font-medium">Format</th>
                  <th class="font-medium">Required</th>
                </tr>
              </thead>
              <tbody>
                {sections.map((section) => (
                  <tr class="border-b border-gray-100">
                    <td class="py-3">
                      <code safe>{section.key}</code>
                      <span safe class="ml-3 text-gray-500">
                        {section.name}
                      </span>
                    </td>
                    <td>{section.format}</td>
                    <td>{section.required ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </Card>
      <Card>
        <section>
          <h2 class="m-0 text-base font-semibold">Source</h2>
          <p class="mb-4 mt-1 text-sm text-gray-500">
            This page is read only. Update the template through MCP or the API.
          </p>
          <div class="border-t border-gray-200">
            <details class="border-b border-gray-200" open>
              <summary class="cursor-pointer py-3 text-sm font-medium">
                {template.sourceFormat.toUpperCase()}
              </summary>
              <div class="template-source">{sources.html}</div>
            </details>
            <details class="border-b border-gray-200">
              <summary class="cursor-pointer py-3 text-sm font-medium">
                Plain text
              </summary>
              <div class="template-source">{sources.text}</div>
            </details>
            {Object.keys(partials).map((name) => (
              <details class="border-b border-gray-200">
                <summary class="cursor-pointer py-3 text-sm font-medium">
                  Partial: <code safe>{name}</code>
                </summary>
                <div class="template-source">{sources.partials[name]}</div>
              </details>
            ))}
          </div>
        </section>
      </Card>
    </AdminLayout>
  );
}
