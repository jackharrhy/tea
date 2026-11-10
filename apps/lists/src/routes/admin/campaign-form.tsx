/** @jsxRuntime classic */
/** @jsx Html.createElement */
/** @jsxFrag Html.Fragment */
// oxlint-disable-next-line no-unused-vars -- Html is the classic JSX factory.
import { Html } from "@elysia/html";
import type { schema } from "../../db";
import type { Config } from "../../config";
import { AdminLayout, type User } from "./layout";
import { Button, Card, FormGroup, Input, Label, Select, Textarea } from "./ui";
import type { TemplateSection } from "../../services/email-templates";

type List = typeof schema.lists.$inferSelect;
type Tag = typeof schema.tags.$inferSelect;
type Subscriber = typeof schema.subscribers.$inferSelect;
type Campaign = typeof schema.campaigns.$inferSelect;
export type CampaignTemplateChoice = {
  slug: string;
  name: string;
  sections: TemplateSection[];
};

type CampaignEditorPageProps = {
  user: User;
  flash?: string;
  config: Config;
  lists: List[];
  tags: Tag[];
  subscribers: Subscriber[];
  campaign?: Campaign;
  templates: CampaignTemplateChoice[];
};

function PreviewPanel({ campaignId }: { campaignId?: number }) {
  return (
    <>
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-2xl font-bold mt-0 mb-0">
          {campaignId ? "Edit campaign" : "New campaign"}
        </h1>
        <button
          type="button"
          onclick="togglePreviewPanel()"
          id="previewToggleBtn"
          class="px-3 py-1.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-200 border border-gray-300 cursor-pointer"
        >
          Preview
        </button>
      </div>
      <div
        id="previewPanel"
        class="hidden fixed inset-0 z-40 bg-gray-100 flex flex-col"
      >
        <div class="bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="text-sm font-medium text-gray-700">Preview</span>
            <div class="flex items-center gap-1 ml-4">
              {[375, 600, 768, 1024].map((width) => (
                <button
                  type="button"
                  onclick={`setPreviewWidth(${width})`}
                  class="px-2 py-0.5 text-xs border border-gray-300 rounded hover:bg-gray-100 cursor-pointer bg-white text-gray-600"
                >
                  {width}
                </button>
              ))}
              <button
                type="button"
                onclick="setPreviewWidth(null)"
                class="px-2 py-0.5 text-xs border border-gray-300 rounded hover:bg-gray-100 cursor-pointer bg-white text-gray-600"
              >
                full
              </button>
              <span
                id="previewWidthLabel"
                class="text-xs text-gray-400 ml-2"
              ></span>
            </div>
          </div>
          <button
            type="button"
            onclick="togglePreviewPanel()"
            class="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-800 border border-gray-200 rounded cursor-pointer bg-white"
          >
            Close
          </button>
        </div>
        <div class="flex-1 overflow-auto flex justify-center py-4">
          <div
            id="previewContainer"
            class="relative"
            style="width: 100%; max-width: 100%;"
          >
            <iframe
              id="previewFrame"
              sandbox=""
              style="min-height: calc(100vh - 80px); width: 100%; border: 0; background: white; display: block; margin: 0 auto;"
              {...(campaignId
                ? { src: `/admin/campaigns/${campaignId}/preview` }
                : {
                    srcdoc:
                      "<p style='color:#999;font-family:system-ui;padding:2rem'>Start writing to see a preview</p>",
                  })}
            />
          </div>
        </div>
      </div>
    </>
  );
}

function ImageModal() {
  return (
    <div
      id="imageModal"
      class="hidden fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50"
    >
      <div class="bg-white rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl">
        <h3 class="font-semibold text-gray-800 mb-1" id="imageModalName"></h3>
        <p class="text-xs text-gray-500 mb-4" id="imageModalSize"></p>
        <div class="flex flex-col gap-2">
          <button
            type="button"
            id="imageEmbedBtn"
            class="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 border-none cursor-pointer"
          >
            Embed in email (inline attachment, always displays)
          </button>
          <button
            type="button"
            id="imageS3Btn"
            class="px-4 py-2 bg-white text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 border border-gray-300 cursor-pointer"
          >
            Host on S3 (smaller email size)
          </button>
          <button
            type="button"
            id="imageModalClose"
            class="px-4 py-2 text-gray-500 text-sm hover:text-gray-700 border-none cursor-pointer bg-transparent"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export function CampaignEditorPage(props: CampaignEditorPageProps) {
  const { campaign, lists, tags, subscribers, templates } = props;
  const mode =
    campaign?.audienceType === "subscribers"
      ? "specific"
      : (campaign?.audienceType ?? "list");
  const selectedSubscriberIds =
    campaign?.audienceType === "subscribers" && campaign.audienceData
      ? (JSON.parse(campaign.audienceData) as number[])
      : [];
  const subscriberData = subscribers.map(
    ({ id, email, firstName, lastName }) => ({
      id,
      email,
      firstName,
      lastName,
    }),
  );
  const scheduledLocal = campaign?.scheduledAt
    ? new Date(
        new Date(campaign.scheduledAt).getTime() -
          new Date().getTimezoneOffset() * 60_000,
      )
        .toISOString()
        .slice(0, 16)
    : undefined;
  const savedSections = campaign?.templateSections
    ? (JSON.parse(campaign.templateSections) as Record<string, string>)
    : {};
  const selectedTemplateSlug = campaign?.templateSlug ?? templates[0]?.slug;

  return (
    <AdminLayout
      title={campaign ? `Edit: ${campaign.subject}` : "New Campaign"}
      user={props.user}
      flash={props.flash}
    >
      <PreviewPanel campaignId={campaign?.id} />
      <div class="max-w-2xl">
        <Card>
          <form
            method="post"
            action={
              campaign
                ? `/admin/campaigns/${campaign.id}/edit`
                : "/admin/campaigns/new"
            }
            data-campaign-editor
            data-subscribers={JSON.stringify(subscriberData)}
            data-selected-subscriber-ids={JSON.stringify(selectedSubscriberIds)}
          >
            <FormGroup>
              <Label for="audienceMode">Audience</Label>
              <Select id="audienceMode" name="audienceMode" required>
                <option value="list" selected={mode === "list"}>
                  A list
                </option>
                <option value="all" selected={mode === "all"}>
                  All subscribers
                </option>
                <option value="tag" selected={mode === "tag"}>
                  A tag
                </option>
                <option value="specific" selected={mode === "specific"}>
                  Specific people
                </option>
              </Select>
            </FormGroup>

            <div
              data-audience="list"
              class={`mb-4${mode !== "list" ? " hidden" : ""}`}
            >
              <Label for="listId">List</Label>
              <Select id="listId" name="listId">
                <option value="">Select a list...</option>
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
              </Select>
            </div>

            <div
              data-audience="tag"
              class={`mb-4${mode !== "tag" ? " hidden" : ""}`}
            >
              <Label for="tagId">Tag</Label>
              <Select id="tagId" name="tagId">
                <option value="">Select a tag...</option>
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
              </Select>
            </div>

            <div
              data-audience="specific"
              class={`mb-4${mode !== "specific" ? " hidden" : ""}`}
            >
              <Label>Subscribers</Label>
              <input
                type="text"
                id="subscriberSearch"
                placeholder="Search by email or name..."
                class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <div
                id="searchResults"
                class="border border-gray-200 rounded-md max-h-40 overflow-y-auto hidden"
              ></div>
              <div
                id="selectedSubscribers"
                class="flex flex-wrap gap-2 mt-2"
              ></div>
              <input
                type="hidden"
                name="subscriberIds"
                id="subscriberIds"
                value={selectedSubscriberIds.join(",")}
              />
            </div>

            <FormGroup>
              <Label for="templateSlug">Email template</Label>
              <Select id="templateSlug" name="templateSlug" required>
                {templates.map((template) => (
                  <option
                    value={template.slug}
                    selected={template.slug === selectedTemplateSlug}
                  >
                    {template.name}
                  </option>
                ))}
              </Select>
            </FormGroup>
            <div
              id="templateSections"
              data-template-sections={JSON.stringify(templates)}
            >
              {templates.flatMap((template) =>
                template.sections
                  .filter((section) => section.key !== "content")
                  .map((section) => (
                    <div
                      data-template={template.slug}
                      class={
                        template.slug === selectedTemplateSlug ? "" : "hidden"
                      }
                    >
                      <FormGroup>
                        <Label>
                          {section.name}
                          {section.required ? "" : " (optional)"}
                        </Label>
                        <Textarea
                          data-template-section={section.key}
                          data-format={section.format}
                          required={section.required}
                        >
                          {savedSections[section.key] ?? ""}
                        </Textarea>
                      </FormGroup>
                    </div>
                  )),
              )}
            </div>
            <input
              type="hidden"
              name="templateSectionsJson"
              id="templateSectionsJson"
              value={JSON.stringify(savedSections)}
            />
            <FormGroup>
              <Label for="fromPersona">From</Label>
              <Select id="fromPersona" name="fromPersona">
                <option value="">Custom…</option>
                {lists.map((list) => (
                  <option
                    value={String(list.id)}
                    data-from-address={list.fromAddress}
                    data-from-name={list.name}
                    data-from-domain={list.fromDomain}
                    data-slug={list.slug}
                  >
                    {list.name} ({list.fromDomain})
                  </option>
                ))}
              </Select>
            </FormGroup>
            <div id="fromCustomFields">
              <FormGroup>
                <Label for="fromAddress">From Address</Label>
                <Input
                  type="email"
                  id="fromAddress"
                  name="fromAddress"
                  required
                  value={campaign?.fromAddress}
                  placeholder={`newsletter@${props.config.fromDomain}`}
                />
              </FormGroup>
              <FormGroup>
                <Label for="fromName">From Name (optional)</Label>
                <Input
                  type="text"
                  id="fromName"
                  name="fromName"
                  value={campaign?.fromName ?? ""}
                  placeholder="e.g. Silicon Harbour"
                />
              </FormGroup>
            </div>
            <FormGroup>
              <Label for="subject">Subject</Label>
              <Input
                type="text"
                id="subject"
                name="subject"
                required
                value={campaign?.subject}
                placeholder="Campaign subject"
              />
            </FormGroup>
            <FormGroup>
              <Label for="bodyMarkdown">Body (Markdown)</Label>
              <Textarea
                id="bodyMarkdown"
                name="bodyMarkdown"
                required
                placeholder="Write your email in markdown…"
              >
                {campaign?.bodyMarkdown ?? ""}
              </Textarea>
              <p class="text-xs text-gray-400 mt-1">
                {
                  "Available variables: {{firstName}}, {{lastName}}, {{email}}, {{unsubscribeUrl}}, {{preferencesUrl}}"
                }
              </p>
              <div
                id="imageDropZone"
                class="border-2 border-dashed border-gray-200 rounded-md p-3 mt-1 text-center text-xs text-gray-400 hover:border-blue-300 transition-colors cursor-pointer"
              >
                Drop an image here or{" "}
                <span class="text-blue-500">click to upload</span>
                <input
                  type="file"
                  id="imageFileInput"
                  accept="image/*"
                  class="hidden"
                />
              </div>
              <input
                type="hidden"
                id="pendingImagesJson"
                name="pendingImagesJson"
                value="{}"
              />
            </FormGroup>

            <h3 class="text-sm font-semibold text-gray-700 mt-6 mb-3">
              Sending options
            </h3>
            <FormGroup>
              <Label for="scheduledAtLocal">
                Schedule for (optional, your local time)
              </Label>
              <Input
                type="datetime-local"
                id="scheduledAtLocal"
                value={scheduledLocal}
              />
              <input
                type="hidden"
                id="scheduledAt"
                name="scheduledAt"
                value={campaign?.scheduledAt ?? ""}
              />
              <p class="text-xs text-gray-400 mt-1" id="scheduledAtUtc">
                {campaign?.scheduledAt
                  ? `UTC: ${new Date(campaign.scheduledAt).toUTCString()}`
                  : ""}
              </p>
            </FormGroup>
            <div id="batchOptions">
              <div class="flex gap-4">
                <FormGroup>
                  <Label for="batchSize">Batch size (emails per batch)</Label>
                  <Input
                    type="number"
                    id="batchSize"
                    name="batchSize"
                    min="1"
                    value={campaign?.batchSize ?? undefined}
                    placeholder="e.g. 20 (leave empty to send all at once)"
                  />
                </FormGroup>
                <FormGroup>
                  <Label for="batchInterval">Minutes between batches</Label>
                  <Input
                    type="number"
                    id="batchInterval"
                    name="batchInterval"
                    min="1"
                    value={campaign?.batchInterval ?? undefined}
                    placeholder="e.g. 10"
                  />
                </FormGroup>
              </div>
            </div>
            <Button type="submit">
              {campaign ? "Save Changes" : "Create Draft"}
            </Button>
          </form>
        </Card>
      </div>
      <ImageModal />
    </AdminLayout>
  );
}
