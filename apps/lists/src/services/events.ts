import type { Db } from "../db";
import { schema } from "../db";

type LogEventOpts = {
  type: string;
  detail: string;
  meta?: Record<string, unknown>;
  userId?: number;
  subscriberId?: number;
  campaignId?: number;
  messageId?: number;
};

export function logEvent(db: Pick<Db, "insert">, opts: LogEventOpts) {
  db.insert(schema.events)
    .values({
      type: opts.type,
      detail: opts.detail,
      meta: opts.meta ? JSON.stringify(opts.meta) : null,
      userId: opts.userId ?? null,
      subscriberId: opts.subscriberId ?? null,
      campaignId: opts.campaignId ?? null,
      messageId: opts.messageId ?? null,
    })
    .run();
}
