import {
  SESv2Client,
  SendEmailCommand,
  type SendEmailCommandInput,
} from "@aws-sdk/client-sesv2";
import * as nodemailer from "nodemailer";
import type { Config } from "../config";
import { awsClientConfig } from "./aws";

export type SendResult = { MessageId?: string };

/** Send through SES in production or capture the same message in a local SMTP inbox. */
export async function sendEmail(
  config: Config,
  input: SendEmailCommandInput,
  options: { signal?: AbortSignal } = {},
): Promise<SendResult> {
  if (!config.smtpUrl) {
    return new SESv2Client(awsClientConfig(config)).send(
      new SendEmailCommand(input),
      {
        abortSignal: options.signal,
      },
    );
  }

  options.signal?.throwIfAborted();

  const transport = nodemailer.createTransport(config.smtpUrl);
  const raw = input.Content?.Raw?.Data;
  if (raw) {
    const from = input.FromEmailAddress;
    const to = [
      ...(input.Destination?.ToAddresses ?? []),
      ...(input.Destination?.CcAddresses ?? []),
      ...(input.Destination?.BccAddresses ?? []),
    ];
    if (!from || to.length === 0)
      throw new Error(
        "Raw email requires a sender and recipient for local SMTP",
      );
    const info = await transport.sendMail({
      raw: Buffer.from(raw),
      envelope: { from, to },
    });
    options.signal?.throwIfAborted();
    return { MessageId: info.messageId };
  }

  const simple = input.Content?.Simple;
  if (!simple) throw new Error("Email content must be Raw or Simple");
  const info = await transport.sendMail({
    from: input.FromEmailAddress,
    to: input.Destination?.ToAddresses,
    cc: input.Destination?.CcAddresses,
    bcc: input.Destination?.BccAddresses,
    subject: simple.Subject?.Data,
    html: simple.Body?.Html?.Data,
    text: simple.Body?.Text?.Data,
  });
  options.signal?.throwIfAborted();
  return { MessageId: info.messageId };
}
