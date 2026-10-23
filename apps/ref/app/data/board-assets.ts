import type { LinkPreview } from "./protocol.ts";

interface LinkRow extends Record<string, SqlStorageValue> {
  asset_id: string;
  url: string;
  title: string;
  description: string;
  image_url: string | null;
  site_name: string;
}

interface AssetRow extends Record<string, SqlStorageValue> {
  id: string;
  object_key: string;
  filename: string;
  content_type: string;
  size: number;
}

interface AssetInput {
  id: string;
  objectKey: string;
  filename: string;
  contentType: string;
  size: number;
}

const LINK_ASSET_TYPE = "application/x-ref-link";

export class BoardAssets {
  constructor(
    private ctx: DurableObjectState,
    private media: R2Bucket,
  ) {}

  recordAsset(asset: AssetInput): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO assets VALUES (?, ?, ?, ?, ?, ?)",
      asset.id,
      asset.objectKey,
      asset.filename,
      asset.contentType,
      asset.size,
      Date.now(),
    );
  }

  restoreAsset(asset: AssetInput): boolean {
    const existing = this.ctx.storage.sql
      .exec<AssetRow>("SELECT * FROM assets WHERE id = ?", asset.id)
      .toArray()[0];
    if (existing) {
      return (
        existing.object_key === asset.objectKey &&
        existing.filename === asset.filename &&
        existing.content_type === asset.contentType &&
        existing.size === asset.size
      );
    }
    this.recordAsset(asset);
    return true;
  }

  recordLink(preview: LinkPreview): {
    assetId: string;
    preview: LinkPreview;
    existingItemId: string | null;
  } {
    const existing = this.existingLink(preview.url);
    if (existing) return existing;
    const assetId = crypto.randomUUID();
    this.insertLink(assetId, preview);
    return { assetId, preview, existingItemId: null };
  }

  existingLink(url: string): {
    assetId: string;
    preview: LinkPreview;
    existingItemId: string | null;
  } | null {
    const existing = this.ctx.storage.sql
      .exec<LinkRow>("SELECT * FROM links WHERE url = ?", url)
      .toArray()[0];
    if (!existing) return null;
    const item = this.ctx.storage.sql
      .exec<{ id: string }>(
        "SELECT id FROM items WHERE asset_id = ? LIMIT 1",
        existing.asset_id,
      )
      .toArray()[0];
    return {
      assetId: existing.asset_id,
      preview: toPreview(existing),
      existingItemId: item?.id ?? null,
    };
  }

  replaceLink(
    boardId: string,
    assetId: string,
    preview: LinkPreview,
  ): {
    assetId: string;
    preview: LinkPreview;
    existingItemId: string | null;
    changed: boolean;
  } | null {
    const existing = this.existingLink(preview.url);
    if (!existing || existing.assetId !== assetId) return null;
    const changed =
      existing.preview.title !== preview.title ||
      existing.preview.description !== preview.description ||
      existing.preview.imageUrl !== preview.imageUrl ||
      existing.preview.siteName !== preview.siteName;
    if (!changed) return { ...existing, changed: false };
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "UPDATE links SET title = ?, description = ?, image_url = ?, site_name = ? WHERE asset_id = ?",
        preview.title,
        preview.description,
        preview.imageUrl,
        preview.siteName,
        assetId,
      );
      this.ctx.storage.sql.exec(
        "UPDATE assets SET filename = ? WHERE id = ?",
        preview.title,
        assetId,
      );
      this.ctx.storage.sql.exec(
        "UPDATE items SET filename = ? WHERE asset_id = ?",
        preview.title,
        assetId,
      );
    });
    if (existing.preview.imageUrl !== preview.imageUrl)
      this.queueUnusedPreview(boardId, existing.preview.imageUrl);
    return { ...existing, preview, changed: true };
  }

  restoreLink(assetId: string, preview: LinkPreview): boolean {
    const existing = this.ctx.storage.sql
      .exec<LinkRow>(
        "SELECT * FROM links WHERE asset_id = ? OR url = ?",
        assetId,
        preview.url,
      )
      .toArray()[0];
    if (existing) {
      return (
        existing.asset_id === assetId &&
        existing.url === preview.url &&
        existing.title === preview.title &&
        existing.description === preview.description &&
        existing.image_url === preview.imageUrl &&
        existing.site_name === preview.siteName
      );
    }
    this.insertLink(assetId, preview);
    return true;
  }

  itemMetadata(
    assetId: string,
  ): { filename: string; link?: LinkPreview } | null {
    const asset = this.ctx.storage.sql
      .exec<AssetRow>("SELECT * FROM assets WHERE id = ?", assetId)
      .toArray()[0];
    if (!asset) return null;
    const link = this.ctx.storage.sql
      .exec<LinkRow>("SELECT * FROM links WHERE asset_id = ?", assetId)
      .toArray()[0];
    return {
      filename: asset.filename,
      ...(link ? { link: toPreview(link) } : {}),
    };
  }

  asset(
    assetId: string,
  ): { objectKey: string; contentType: string; size: number } | null {
    const row = this.ctx.storage.sql
      .exec<AssetRow>("SELECT * FROM assets WHERE id = ?", assetId)
      .toArray()[0];
    return row && row.content_type !== LINK_ASSET_TYPE
      ? {
          objectKey: row.object_key,
          contentType: row.content_type,
          size: row.size,
        }
      : null;
  }

  deleteUnusedAsset(boardId: string, assetId: string): void {
    if (
      this.ctx.storage.sql
        .exec("SELECT id FROM items WHERE asset_id = ? LIMIT 1", assetId)
        .toArray().length
    )
      return;
    const asset = this.ctx.storage.sql
      .exec<AssetRow>("SELECT * FROM assets WHERE id = ?", assetId)
      .toArray()[0];
    if (!asset) return;
    const link = this.ctx.storage.sql
      .exec<LinkRow>("SELECT * FROM links WHERE asset_id = ?", assetId)
      .toArray()[0];
    this.ctx.storage.sql.exec("DELETE FROM links WHERE asset_id = ?", assetId);
    this.ctx.storage.sql.exec("DELETE FROM assets WHERE id = ?", assetId);
    if (asset.object_key) this.queueDelete(asset.object_key);
    this.queueUnusedPreview(boardId, link?.image_url ?? null);
  }

  private queueUnusedPreview(boardId: string, imageUrl: string | null): void {
    const prefix = `/previews/${boardId}/`;
    if (!imageUrl?.startsWith(prefix)) return;
    const hash = imageUrl.slice(prefix.length);
    if (
      /^[0-9a-f]{64}$/.test(hash) &&
      !this.ctx.storage.sql
        .exec(
          "SELECT asset_id FROM links WHERE image_url = ? LIMIT 1",
          imageUrl,
        )
        .toArray().length
    ) {
      this.queueDelete(`boards/${boardId}/previews/${hash}`);
    }
  }

  async drainPendingDeletes(): Promise<void> {
    const pending = this.ctx.storage.sql
      .exec<{ object_key: string }>(
        "SELECT object_key FROM pending_deletes LIMIT 20",
      )
      .toArray();
    if (!pending.length) return;
    await this.ctx.storage.setAlarm(Date.now() + 60_000);
    for (const row of pending) {
      try {
        await this.media.delete(row.object_key);
        this.ctx.storage.sql.exec(
          "DELETE FROM pending_deletes WHERE object_key = ?",
          row.object_key,
        );
      } catch (error) {
        console.error("Media cleanup failed", error);
      }
    }
  }

  private insertLink(assetId: string, preview: LinkPreview): void {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "INSERT INTO assets VALUES (?, ?, ?, ?, ?, ?)",
        assetId,
        "",
        preview.title,
        LINK_ASSET_TYPE,
        0,
        Date.now(),
      );
      this.ctx.storage.sql.exec(
        "INSERT INTO links VALUES (?, ?, ?, ?, ?, ?)",
        assetId,
        preview.url,
        preview.title,
        preview.description,
        preview.imageUrl,
        preview.siteName,
      );
    });
  }

  private queueDelete(objectKey: string): void {
    this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO pending_deletes VALUES (?)",
      objectKey,
    );
  }
}

function toPreview(row: LinkRow): LinkPreview {
  return {
    url: row.url,
    title: row.title,
    description: row.description,
    imageUrl: row.image_url,
    siteName: row.site_name,
  };
}
