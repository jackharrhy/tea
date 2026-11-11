import { css, type Handle } from "remix/component";

import type { Config } from "../src/config.ts";
import { schema } from "../src/db/index.ts";
import type { TemplateSection } from "../src/services/email-templates.ts";
import { AdminDocument, type Viewer } from "./admin.tsx";

type Campaign = typeof schema.campaigns.$inferSelect;
type List = typeof schema.lists.$inferSelect;
type Tag = typeof schema.tags.$inferSelect;
type Subscriber = Pick<
  typeof schema.subscribers.$inferSelect,
  "id" | "email" | "firstName" | "lastName"
>;
type Template = typeof schema.emailTemplates.$inferSelect;
const heading = css({
  fontSize: "24px",
  lineHeight: "32px",
  fontWeight: 700,
  margin: "0 0 20px",
});
const toolbar = css({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "16px",
  flexWrap: "wrap",
  marginBottom: "18px",
});
const filters = css({
  display: "flex",
  alignItems: "end",
  gap: "12px",
  flexWrap: "wrap",
  marginBottom: "24px",
});
const field = css({
  display: "grid",
  gap: "5px",
  marginBottom: "16px",
  fontSize: "14px",
});
const input = css({
  boxSizing: "border-box",
  minHeight: "38px",
  width: "100%",
  padding: "7px 10px",
  border: "1px solid #d1d5db",
  borderRadius: "6px",
  backgroundColor: "#fff",
  color: "#111827",
  font: "inherit",
});
const textarea = css({
  boxSizing: "border-box",
  width: "100%",
  minHeight: "230px",
  padding: "10px",
  border: "1px solid #d1d5db",
  borderRadius: "6px",
  font: "inherit",
  lineHeight: 1.5,
});
const action = css({
  display: "inline-block",
  padding: "8px 14px",
  border: "1px solid #1f2937",
  borderRadius: "6px",
  backgroundColor: "#1f2937",
  color: "#fff",
  textDecoration: "none",
  font: "inherit",
  fontSize: "14px",
  cursor: "pointer",
});
const smallButton = css({
  padding: "6px 10px",
  border: "1px solid #d1d5db",
  borderRadius: "6px",
  backgroundColor: "#fff",
  color: "#374151",
  cursor: "pointer",
  font: "inherit",
  fontSize: "13px",
});
const table = css({
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "14px",
});
const cell = css({
  padding: "10px 8px",
  borderBottom: "1px solid #e5e7eb",
  textAlign: "left",
});
const link = css({ color: "#1d4ed8", textDecoration: "none" });
const muted = css({ color: "#6b7280", fontSize: "14px" });
const section = css({
  fontSize: "18px",
  fontWeight: 600,
  margin: "28px 0 12px",
});
const form = css({ maxWidth: "680px", "& .hidden": { display: "none" } });
const inline = css({
  display: "flex",
  gap: "8px",
  alignItems: "center",
  flexWrap: "wrap",
});
const previewPanel = css({
  position: "fixed",
  inset: 0,
  zIndex: 50,
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr)",
  padding: "18px",
  backgroundColor: "#f3f4f6",
  "&.hidden": { display: "none" },
});
const previewFrame = css({
  boxSizing: "border-box",
  display: "block",
  width: "100%",
  height: "100%",
  minHeight: "400px",
  margin: "0 auto",
  border: 0,
  backgroundColor: "#fff",
});
const modal = css({
  position: "fixed",
  inset: 0,
  zIndex: 60,
  display: "grid",
  placeItems: "center",
  backgroundColor: "#0008",
  "&.hidden": { display: "none" },
});
const modalCard = css({
  width: "min(100% - 32px, 440px)",
  padding: "22px",
  borderRadius: "8px",
  backgroundColor: "#fff",
});
const dropzone = css({
  padding: "18px",
  border: "2px dashed #cbd5e1",
  borderRadius: "6px",
  textAlign: "center",
  color: "#64748b",
  cursor: "pointer",
});
const notice = css({
  padding: "12px",
  backgroundColor: "#fef2f2",
  color: "#991b1b",
  marginBottom: "18px",
});

export function CampaignIndex(
  handle: Handle<{
    viewer: Viewer;
    rows: Campaign[];
    total: number;
    page: number;
    filters: { status: string; search: string };
  }>,
) {
  return () => {
    const { rows, total, page, filters: selected } = handle.props;
    const q = new URLSearchParams({ ...selected, page: String(page) });
    const pageUrl = (next: number) => {
      q.set("page", String(next));
      return `/admin/campaigns?${q}`;
    };
    return (
      <AdminDocument
        title="Campaigns"
        activeHref="/admin/campaigns"
        viewer={handle.props.viewer}
      >
        <div mix={toolbar}>
          <h1 mix={heading}>Campaigns</h1>
          <a mix={action} href="/admin/campaigns/new">
            New campaign
          </a>
        </div>
        <form mix={filters} method="get" action="/admin/campaigns">
          <label mix={field}>
            Search
            <input
              mix={input}
              name="search"
              value={selected.search}
              placeholder="Subject"
            />
          </label>
          <label mix={field}>
            Status
            <select mix={input} name="status">
              <option value="">All</option>
              {["draft", "scheduled", "sending", "sent", "failed"].map(
                (status) => (
                  <option value={status} selected={selected.status === status}>
                    {status}
                  </option>
                ),
              )}
            </select>
          </label>
          <button mix={action} type="submit">
            Filter
          </button>
          <a mix={link} href="/admin/campaigns">
            Clear
          </a>
        </form>
        <table mix={table}>
          <thead>
            <tr>
              <th mix={cell}>Subject</th>
              <th mix={cell}>Status</th>
              <th mix={cell}>Audience</th>
              <th mix={cell}>Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((campaign) => (
              <tr>
                <td mix={cell}>
                  <a mix={link} href={`/admin/campaigns/${campaign.id}`}>
                    {campaign.subject}
                  </a>
                </td>
                <td mix={cell}>{campaign.status}</td>
                <td mix={cell}>
                  {campaign.audienceType}
                  {campaign.audienceId ? ` #${campaign.audienceId}` : ""}
                </td>
                <td mix={cell}>{campaign.createdAt.slice(0, 10)}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td mix={cell} colSpan={4}>
                  No campaigns match these filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        {total > 25 ? (
          <p mix={inline}>
            {page > 1 ? (
              <a mix={link} href={pageUrl(page - 1)}>
                Previous
              </a>
            ) : null}
            <span>
              Page {page} of {Math.ceil(total / 25)}
            </span>
            {page * 25 < total ? (
              <a mix={link} href={pageUrl(page + 1)}>
                Next
              </a>
            ) : null}
          </p>
        ) : null}
      </AdminDocument>
    );
  };
}

export function CampaignEditor(
  handle: Handle<{
    viewer: Viewer;
    config: Config;
    lists: List[];
    tags: Tag[];
    subscribers: Subscriber[];
    templates: Template[];
    campaign?: Campaign;
    problem?: string;
  }>,
) {
  return () => {
    const {
      campaign,
      viewer: account,
      config,
      lists,
      tags,
      subscribers,
      templates,
      problem,
    } = handle.props;
    const mode =
      campaign?.audienceType === "subscribers"
        ? "specific"
        : (campaign?.audienceType ?? "list");
    const selectedIds =
      campaign?.audienceType === "subscribers" && campaign.audienceData
        ? (JSON.parse(campaign.audienceData) as number[])
        : [];
    const savedSections = campaign?.templateSections
      ? (JSON.parse(campaign.templateSections) as Record<string, string>)
      : {};
    const selectedTemplate =
      campaign?.templateSlug ?? templates[0]?.slug ?? "newsletter";
    return (
      <AdminDocument
        title={campaign ? "Edit campaign" : "New campaign"}
        activeHref="/admin/campaigns"
        viewer={account}
      >
        <div mix={toolbar}>
          <h1 mix={heading}>
            {campaign ? `Edit: ${campaign.subject}` : "New campaign"}
          </h1>
          <button id="previewToggleBtn" mix={smallButton} type="button">
            Preview
          </button>
        </div>
        {problem ? (
          <p mix={notice} role="alert">
            {problem}
          </p>
        ) : null}
        <div mix={form}>
          <form
            method="post"
            action={
              campaign
                ? `/admin/campaigns/${campaign.id}/edit`
                : "/admin/campaigns/new"
            }
            data-campaign-editor
            data-subscribers={JSON.stringify(subscribers)}
            data-selected-subscriber-ids={JSON.stringify(selectedIds)}
          >
            <label mix={field}>
              Audience
              <select
                mix={input}
                id="audienceMode"
                name="audienceMode"
                required
              >
                <option value="list" selected={mode === "list"}>
                  A list
                </option>
                {account.isAdmin ? (
                  <option value="all" selected={mode === "all"}>
                    All subscribers
                  </option>
                ) : null}
                {account.isAdmin ? (
                  <option value="tag" selected={mode === "tag"}>
                    A tag
                  </option>
                ) : null}
                {account.isAdmin ? (
                  <option value="specific" selected={mode === "specific"}>
                    Specific people
                  </option>
                ) : null}
              </select>
            </label>
            <div data-audience="list" class={mode === "list" ? "" : "hidden"}>
              <label mix={field}>
                List
                <select mix={input} id="listId" name="listId">
                  <option value="">Select a list</option>
                  {lists.map((list) => (
                    <option
                      value={String(list.id)}
                      data-from-address={list.fromAddress}
                      selected={
                        campaign?.audienceType === "list" &&
                        campaign.audienceId === list.id
                      }
                    >
                      {list.name} ({list.slug})
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div data-audience="tag" class={mode === "tag" ? "" : "hidden"}>
              <label mix={field}>
                Tag
                <select mix={input} id="tagId" name="tagId">
                  <option value="">Select a tag</option>
                  {tags.map((tag) => (
                    <option
                      value={String(tag.id)}
                      selected={
                        campaign?.audienceType === "tag" &&
                        campaign.audienceId === tag.id
                      }
                    >
                      {tag.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div
              data-audience="specific"
              class={mode === "specific" ? "" : "hidden"}
            >
              <label mix={field}>
                Find subscribers
                <input
                  mix={input}
                  id="subscriberSearch"
                  placeholder="Email or name"
                />
              </label>
              <div id="searchResults" class="hidden" />
              <div id="selectedSubscribers" mix={inline} />
              <input
                type="hidden"
                name="subscriberIds"
                id="subscriberIds"
                value={selectedIds.join(",")}
              />
            </div>
            <label mix={field}>
              Email template
              <select
                mix={input}
                id="templateSlug"
                name="templateSlug"
                required
              >
                {templates.map((template) => (
                  <option
                    value={template.slug}
                    selected={template.slug === selectedTemplate}
                  >
                    {template.name}
                  </option>
                ))}
              </select>
            </label>
            <div id="templateSections">
              {templates.map((template) => (
                <div
                  data-template={template.slug}
                  class={template.slug === selectedTemplate ? "" : "hidden"}
                >
                  {(JSON.parse(template.sections) as TemplateSection[])
                    .filter((section) => section.key !== "content")
                    .map((section) => (
                      <label mix={field}>
                        {section.name}
                        {section.required ? "" : " (optional)"}
                        <textarea
                          mix={textarea}
                          data-template-section={section.key}
                          data-format={section.format}
                          required={section.required}
                          value={savedSections[section.key] ?? ""}
                        />
                      </label>
                    ))}
                </div>
              ))}
            </div>
            <input
              type="hidden"
              id="templateSectionsJson"
              name="templateSectionsJson"
              value={JSON.stringify(savedSections)}
            />
            <label mix={field}>
              From preset
              <select mix={input} id="fromPersona" name="fromPersona">
                <option value="">Custom</option>
                {lists.map((list) => (
                  <option
                    value={String(list.id)}
                    data-from-address={list.fromAddress}
                    data-from-name={list.name}
                    data-from-domain={list.fromDomain}
                    data-slug={list.slug}
                  >
                    {list.name}
                  </option>
                ))}
              </select>
            </label>
            <div id="fromCustomFields">
              <label mix={field}>
                From address
                <input
                  mix={input}
                  type="email"
                  id="fromAddress"
                  name="fromAddress"
                  required
                  value={campaign?.fromAddress ?? ""}
                  placeholder={`newsletter@${config.fromDomain}`}
                />
              </label>
              <label mix={field}>
                From name
                <input
                  mix={input}
                  id="fromName"
                  name="fromName"
                  value={campaign?.fromName ?? ""}
                />
              </label>
            </div>
            <label mix={field}>
              Subject
              <input
                mix={input}
                id="subject"
                name="subject"
                required
                value={campaign?.subject ?? ""}
              />
            </label>
            <label mix={field}>
              Body (Markdown)
              <textarea
                mix={textarea}
                id="bodyMarkdown"
                name="bodyMarkdown"
                required
                value={campaign?.bodyMarkdown ?? ""}
              />
            </label>
            <p mix={muted}>
              Variables:{" "}
              {
                "{{firstName}}, {{lastName}}, {{email}}, {{unsubscribeUrl}}, {{preferencesUrl}}"
              }
            </p>
            <div id="imageDropZone" mix={dropzone}>
              Drop an image here or click to upload
              <input type="file" id="imageFileInput" accept="image/*" hidden />
            </div>
            <input
              type="hidden"
              id="pendingImagesJson"
              name="pendingImagesJson"
              value="{}"
            />
            <h2 mix={section}>Sending options</h2>
            <label mix={field}>
              Schedule for (local time)
              <input
                mix={input}
                type="datetime-local"
                id="scheduledAtLocal"
                value={
                  campaign?.scheduledAt
                    ? new Date(campaign.scheduledAt).toISOString().slice(0, 16)
                    : ""
                }
              />
            </label>
            <input
              type="hidden"
              id="scheduledAt"
              name="scheduledAt"
              value={campaign?.scheduledAt ?? ""}
            />
            <p id="scheduledAtUtc" mix={muted}>
              {campaign?.scheduledAt ?? ""}
            </p>
            <label mix={field}>
              Batch size
              <input
                mix={input}
                type="number"
                min="1"
                name="batchSize"
                value={campaign?.batchSize ?? ""}
              />
            </label>
            <label mix={field}>
              Minutes between batches
              <input
                mix={input}
                type="number"
                min="1"
                name="batchInterval"
                value={campaign?.batchInterval ?? ""}
              />
            </label>
            <button mix={action} type="submit">
              {campaign ? "Save campaign" : "Create campaign"}
            </button>
          </form>
        </div>
        <div id="previewPanel" mix={previewPanel} class="hidden">
          <div mix={toolbar}>
            <strong>Campaign preview</strong>
            <div mix={inline}>
              {[375, 600].map((width) => (
                <button
                  mix={smallButton}
                  type="button"
                  data-preview-width={String(width)}
                >
                  {width}px
                </button>
              ))}
              <button mix={smallButton} type="button" data-preview-width="full">
                Full width
              </button>
              <span id="previewWidthLabel" />
            </div>
            <button id="previewCloseBtn" mix={smallButton} type="button">
              Close
            </button>
          </div>
          <iframe
            id="previewFrame"
            mix={previewFrame}
            title="Campaign preview"
            sandbox=""
            src={
              campaign ? `/admin/campaigns/${campaign.id}/preview` : undefined
            }
          />
        </div>
        <div id="imageModal" mix={modal} class="hidden">
          <div mix={modalCard}>
            <h2 id="imageModalName">Image</h2>
            <p id="imageModalSize" mix={muted} />
            <div mix={inline}>
              <button id="imageEmbedBtn" mix={smallButton} type="button">
                Embed in email
              </button>
              <button id="imageS3Btn" mix={smallButton} type="button">
                Host on S3
              </button>
              <button id="imageModalClose" mix={smallButton} type="button">
                Cancel
              </button>
            </div>
          </div>
        </div>
        <script src="/static/campaign.js" defer />
      </AdminDocument>
    );
  };
}

export function CampaignDetail(
  handle: Handle<{
    viewer: Viewer;
    campaign: Campaign;
    audience: string;
    sends: Array<{ email: string; status: string; lastError: string | null }>;
    totalRecipients: number;
    selectedTestCount: number | null;
  }>,
) {
  return () => {
    const { campaign, audience, sends, totalRecipients, selectedTestCount } =
      handle.props;
    const base = `/admin/campaigns/${campaign.id}`;
    return (
      <AdminDocument
        title={campaign.subject}
        activeHref="/admin/campaigns"
        viewer={handle.props.viewer}
      >
        <a mix={link} href="/admin/campaigns">
          ← Campaigns
        </a>
        <div mix={toolbar}>
          <h1 mix={heading}>{campaign.subject}</h1>
          {["draft", "failed", "scheduled"].includes(campaign.status) ? (
            <a mix={action} href={`${base}/edit`}>
              Edit
            </a>
          ) : null}
        </div>
        <p mix={muted}>
          Status: {campaign.status} · Audience: {audience} · Send records:{" "}
          {totalRecipients} · Created {campaign.createdAt.slice(0, 16)}
        </p>
        {selectedTestCount !== null ? (
          <p mix={notice}>
            Test: {selectedTestCount} selected from {audience}. This campaign
            was not sent to the full list.
          </p>
        ) : null}
        <p mix={muted}>
          From:{" "}
          {campaign.fromName
            ? `${campaign.fromName} <${campaign.fromAddress}>`
            : campaign.fromAddress}
        </p>
        {campaign.lastError ? (
          <p mix={notice} role="alert">
            {campaign.lastError}
          </p>
        ) : null}
        <div mix={inline}>
          <a mix={link} href={`${base}/preview`}>
            Preview email
          </a>
          {campaign.status === "draft" ? (
            <form method="post" action={`${base}/send`}>
              <button mix={action} type="submit">
                Send campaign
              </button>
            </form>
          ) : null}
          {campaign.status === "failed" ? (
            <form method="post" action={`${base}/retry`}>
              <button mix={action} type="submit">
                Retry
              </button>
            </form>
          ) : null}
          {campaign.status === "failed" ? (
            <form method="post" action={`${base}/reset`}>
              <button mix={smallButton} type="submit">
                Reset to draft
              </button>
            </form>
          ) : null}
          {campaign.status === "scheduled" ? (
            <form method="post" action={`${base}/unschedule`}>
              <button mix={smallButton} type="submit">
                Unschedule
              </button>
            </form>
          ) : null}
        </div>
        <h2 mix={section}>Message</h2>
        <div mix={muted}>{campaign.bodyMarkdown}</div>
        <h2 mix={section}>Send history</h2>
        <table mix={table}>
          <thead>
            <tr>
              <th mix={cell}>Recipient</th>
              <th mix={cell}>Status</th>
              <th mix={cell}>Error</th>
            </tr>
          </thead>
          <tbody>
            {sends.map((send) => (
              <tr>
                <td mix={cell}>{send.email}</td>
                <td mix={cell}>{send.status}</td>
                <td mix={cell}>{send.lastError ?? ""}</td>
              </tr>
            ))}
            {sends.length === 0 ? (
              <tr>
                <td mix={cell} colSpan={3}>
                  No sends yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <h2 mix={section}>Delete</h2>
        <form method="post" action={`${base}/delete`}>
          <button mix={smallButton} type="submit">
            Delete campaign
          </button>
        </form>
      </AdminDocument>
    );
  };
}

export function previewResponse(html: string) {
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; img-src data: cid:; font-src data:",
    },
  });
}
export function textPreview(text: string) {
  const escaped = text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return `<pre style="white-space:pre-wrap;font-family:system-ui;padding:24px">${escaped}</pre>`;
}
