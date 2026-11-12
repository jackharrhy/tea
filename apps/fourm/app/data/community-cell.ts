import { DurableObject } from "cloudflare:workers";
import { createCommunity, CommunityError } from "./community.ts";
import type { Row } from "./community.ts";

export class CommunityCell extends DurableObject<Env> {
  private community;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.community = createCommunity({
      all: (sql, ...values) =>
        ctx.storage.sql.exec(sql, ...values).toArray() as Row[],
      transaction: (operation) => ctx.storage.transactionSync(operation),
    });
  }
  // The Worker is the only binding holder. HTTP callers cannot name RPC methods or SQL.
  async call<K extends keyof typeof this.community>(
    method: K,
    args: Parameters<(typeof this.community)[K]>,
  ) {
    try {
      const operation = this.community[method] as (
        ...args: unknown[]
      ) => unknown;
      const value = operation.apply(this.community, args);
      if (this.community.hasMediaTransfers()) {
        const current = await this.ctx.storage.getAlarm();
        const next = Date.now() + 30000;
        if (current === null || current > next)
          await this.ctx.storage.setAlarm(next);
      }
      return { ok: true as const, value };
    } catch (error) {
      if (error instanceof CommunityError)
        return {
          ok: false as const,
          status: error.status,
          error: error.message,
        };
      throw error;
    }
  }
  async alarm() {
    for (const item of this.community.pendingMediaDeletes()) {
      await this.env.MEDIA.delete(String(item.storage_path));
      this.community.finishMediaDelete(String(item.storage_path));
    }
    if (this.community.hasMediaTransfers())
      await this.ctx.storage.setAlarm(Date.now() + 30000);
  }
}
