import { eq } from "drizzle-orm";
import type { Db } from "../db";
import { schema } from "../db";
import { renderTemplate } from "./email-templates";

type CampaignRenderModel = Pick<
  typeof schema.campaigns.$inferSelect,
  "subject" | "bodyMarkdown" | "templateSlug" | "templateSections"
>;

export type CampaignRenderInput = {
  campaign: CampaignRenderModel;
  subscriber: {
    email: string;
    firstName?: string | null;
    lastName?: string | null;
  };
  list: { name: string; slug?: string };
  links: { unsubscribe: string; preferences: string };
};

export async function renderCampaignMessage(
  db: Db,
  { campaign, subscriber, list, links }: CampaignRenderInput,
) {
  const template = db
    .select()
    .from(schema.emailTemplates)
    .where(eq(schema.emailTemplates.slug, campaign.templateSlug))
    .get();
  if (!template)
    throw new Error(`Email template not found: ${campaign.templateSlug}`);
  return renderTemplate(template, {
    subscriber,
    campaign: { subject: campaign.subject },
    list,
    links,
    sectionSources: {
      ...(JSON.parse(campaign.templateSections) as Record<string, string>),
      content: campaign.bodyMarkdown,
    },
  });
}
