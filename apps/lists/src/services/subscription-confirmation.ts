import { SendEmailCommand } from "@aws-sdk/client-sesv2";
import type { Config } from "../config";
import type { schema } from "../db";
import { buildConfirmUrl } from "../compliance";
import { renderConfirmation } from "../../emails/render";
import { sendEmail } from "./mailer";

type List = typeof schema.lists.$inferSelect;
type Subscriber = typeof schema.subscribers.$inferSelect;

export async function sendSubscriptionConfirmations(
  config: Config,
  subscriber: Subscriber,
  lists: List[],
) {
  const byDomain = new Map<string, List[]>();
  for (const list of lists) {
    const group = byDomain.get(list.fromDomain) ?? [];
    group.push(list);
    byDomain.set(list.fromDomain, group);
  }

  for (const [domain, domainLists] of byDomain) {
    const confirmUrl = buildConfirmUrl(
      config.baseUrl,
      subscriber.unsubscribeToken,
      domain,
    );
    const { html } = await renderConfirmation({
      confirmUrl,
      listNames: domainLists.map((list) => list.name),
    });
    const senderList = domainLists[0]!;
    const senderName = senderList.name.replace(/[\r\n"<>]/g, "");
    const senderAddress = senderList.fromAddress
      .toLowerCase()
      .endsWith(`@${domain.toLowerCase()}`)
      ? senderList.fromAddress
      : `noreply@${domain}`;
    await sendEmail(
      config,
      new SendEmailCommand({
        FromEmailAddress: `"${senderName}" <${senderAddress}>`,
        Destination: { ToAddresses: [subscriber.email] },
        Content: {
          Simple: {
            Subject: { Data: "Confirm your subscription" },
            Body: { Html: { Data: html } },
          },
        },
        ConfigurationSetName: config.sesConfigSet || undefined,
        EmailTags: [
          { Name: "subscriber_id", Value: String(subscriber.id) },
          { Name: "message_kind", Value: "confirmation" },
        ],
      }).input,
    );
  }
  return [...byDomain.keys()];
}
