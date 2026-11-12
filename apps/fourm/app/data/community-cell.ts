import { processMediaMove, cleanupMediaTransfer } from "../media-move.ts";
import { DurableObject } from "cloudflare:workers";
import { createCommunity, CommunityError } from "./community.ts";
import type { Row } from "./community.ts";

export class CommunityCell extends DurableObject<Env> {
  private community;
  private moves = new Map<number, Promise<void>>();
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
      await this.scheduleMediaWork();
      return { ok: true as const, value };
    } catch (error) {
      if (error instanceof CommunityError)
        return {
          ok: false as const,
          status: error.status,
          error: error.message,
          retryAfter: error.retryAfter,
        };
      throw error;
    }
  }
  private async scheduleMediaWork() {
    if (this.community.hasMediaTransfers() || this.community.hasMediaMoves()) {
      const current = await this.ctx.storage.getAlarm();
      if (current === null || current > Date.now() + 30000)
        await this.ctx.storage.setAlarm(Date.now() + 30000);
    }
  }
  private async runMove(id: number) {
    let running = this.moves.get(id);
    if (!running) {
      running = processMediaMove(this.community, this.env.MEDIA, id);
      this.moves.set(id, running);
    }
    try {
      await running;
    } finally {
      if (this.moves.get(id) === running) this.moves.delete(id);
    }
  }
  private async performMove(begin: () => Row | null) {
    try {
      const move = begin();
      if (move) {
        await this.scheduleMediaWork();
        await this.runMove(Number(move.id));
      }
      return { ok: true as const };
    } catch (error) {
      if (!(error instanceof CommunityError))
        console.error("Media operation interrupted", error);
      return {
        ok: false as const,
        status: error instanceof CommunityError ? error.status : 503,
        error:
          error instanceof CommunityError
            ? error.message
            : "The media move is still recovering. Try again shortly.",
      };
    }
  }
  async renameMedia(actorId: number, mediaId: number, filename: string) {
    return this.performMove(() =>
      this.community.beginMediaRename(actorId, mediaId, filename),
    );
  }
  async renameUsername(actorId: number, username: string) {
    return this.performMove(() =>
      this.community.beginUsernameRename(actorId, username),
    );
  }
  async removeMedia(actorId: number, mediaId: number) {
    try {
      const path = this.community.deleteMedia(actorId, mediaId);
      await this.scheduleMediaWork();
      await this.env.MEDIA.delete(path);
      this.community.finishMediaDelete(path);
      return { ok: true as const };
    } catch (error) {
      if (!(error instanceof CommunityError))
        console.error("Media operation interrupted", error);
      return {
        ok: false as const,
        status: error instanceof CommunityError ? error.status : 503,
        error:
          error instanceof CommunityError
            ? error.message
            : "Media deletion is still recovering. Try again shortly.",
      };
    }
  }
  async alarm() {
    let failure: unknown;
    try {
      for (const move of this.community.pendingMediaMoves()) {
        try {
          await this.runMove(Number(move.id));
        } catch (error) {
          failure ??= error;
        }
      }
      for (const item of this.community.pendingMediaDeletes()) {
        try {
          await cleanupMediaTransfer(this.community, this.env.MEDIA, item);
        } catch (error) {
          failure ??= error;
        }
      }
    } finally {
      await this.scheduleMediaWork();
    }
    if (failure) throw failure;
  }
}
