import { pruneNativeBackups } from "../backup-pruning.ts";
import { runNativeBackup } from "../backup-runner.ts";
import { scanStorage, cleanupOrphanMedia } from "../storage-health.ts";
import {
  processMediaMove,
  cleanupMediaTransfer,
  cleanupAccountMedia,
} from "../media-move.ts";
import { DurableObject } from "cloudflare:workers";
import { createCommunity, CommunityError } from "./community.ts";
import type { Row } from "./community.ts";

export class CommunityCell extends DurableObject<Env> {
  private community;
  private backup: Promise<Row> | undefined;
  private pruning: Promise<{ removed: number }> | undefined;
  private moves = new Map<number, Promise<void>>();
  private orphanCleanup: Promise<number> | undefined;
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
      const value = await operation.apply(this.community, args);
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
  async runBackup(actorId: number | null) {
    try {
      this.community.backupStatus(actorId);
      if (this.pruning)
        throw new CommunityError(
          409,
          "Backup retention is in progress. Try again shortly.",
        );
      const running = (this.backup ??= runNativeBackup(
        this.community,
        this.env.MEDIA,
        actorId,
      ));
      try {
        return { ok: true as const, result: await running };
      } finally {
        if (this.backup === running) this.backup = undefined;
      }
    } catch (error) {
      return {
        ok: false as const,
        status: error instanceof CommunityError ? error.status : 503,
        error:
          error instanceof CommunityError
            ? error.message
            : "Backup response interrupted. Check the backup list before retrying.",
      };
    }
  }
  async pruneBackups(actorId: number | null) {
    try {
      this.community.backupStatus(actorId);
      if (this.backup)
        throw new CommunityError(
          409,
          "A backup is in progress. Try again shortly.",
        );
      const running = (this.pruning ??= pruneNativeBackups(
        this.community,
        this.env.MEDIA,
        actorId,
      ));
      try {
        return { ok: true as const, result: await running };
      } finally {
        if (this.pruning === running) this.pruning = undefined;
      }
    } catch (error) {
      return {
        ok: false as const,
        status: error instanceof CommunityError ? error.status : 503,
        error:
          error instanceof CommunityError
            ? error.message
            : "Backup retention interrupted. Retry to reconcile expired snapshots.",
      };
    }
  }
  private async scheduleMediaWork() {
    if (
      this.community.hasMediaTransfers() ||
      this.community.hasMediaMoves() ||
      this.community.hasAccountCleanup() ||
      this.community.hasOrphanCleanup()
    ) {
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
  async adminRenameUsername(
    actorId: number,
    userId: number,
    username: string,
    displayName: string,
  ) {
    return this.performMove(() =>
      this.community.beginAdminUsernameRename(
        actorId,
        userId,
        username,
        displayName,
      ),
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
  async deleteAccount(actorId: number | null, userId: number, mode: string) {
    try {
      const count = this.community.beginAccountDelete(actorId, userId, mode);
      await this.scheduleMediaWork();
      await cleanupAccountMedia(this.community, this.env.MEDIA);
      await this.scheduleMediaWork();
      return { ok: true as const, count };
    } catch (error) {
      if (!(error instanceof CommunityError))
        console.error("Account cleanup interrupted");
      return {
        ok: false as const,
        status: error instanceof CommunityError ? error.status : 503,
        error:
          error instanceof CommunityError
            ? error.message
            : "Account deletion is committed; media cleanup will retry. Reload the admin page.",
      };
    }
  }
  private async runOrphanCleanup() {
    let running = this.orphanCleanup;
    if (!running) {
      running = cleanupOrphanMedia(this.community, this.env.MEDIA);
      this.orphanCleanup = running;
    }
    try {
      return await running;
    } finally {
      if (this.orphanCleanup === running) this.orphanCleanup = undefined;
    }
  }
  private storageFailure(error: unknown) {
    if (!(error instanceof CommunityError))
      console.error("Storage maintenance interrupted");
    return {
      ok: false as const,
      status: error instanceof CommunityError ? error.status : 503,
      error:
        error instanceof CommunityError
          ? error.message
          : "Storage maintenance interrupted. Pending cleanup will retry.",
    };
  }
  async cleanupOrphanFiles(actorId: number | null) {
    try {
      const scan = await scanStorage(this.env.MEDIA, async () =>
        this.community.adminMediaInventory(actorId),
      );
      for (const file of scan.orphanedFiles)
        this.community.beginOrphanCleanup(actorId, file.path);
      await this.scheduleMediaWork();
      let count = 0;
      while (this.community.hasOrphanCleanup())
        count += await this.runOrphanCleanup();
      return { ok: true as const, count };
    } catch (error) {
      return this.storageFailure(error);
    } finally {
      await this.scheduleMediaWork();
    }
  }
  async cleanupMissingMediaRecords(actorId: number | null) {
    try {
      let count = 0;
      for (const record of this.community.adminMediaRecords(actorId)) {
        const path = String(record.storage_path);
        if (
          !(await this.env.MEDIA.head(path)) &&
          this.community.removeMissingMediaRecord(
            actorId,
            Number(record.id),
            path,
          )
        )
          count++;
      }
      return { ok: true as const, count };
    } catch (error) {
      return this.storageFailure(error);
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
      try {
        await cleanupAccountMedia(this.community, this.env.MEDIA);
      } catch (error) {
        failure ??= error;
      }
      try {
        await this.runOrphanCleanup();
      } catch (error) {
        failure ??= error;
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
