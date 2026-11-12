import { uploadLimit } from "./data/media.ts";
import { CommunityError } from "./data/community.ts";
import type { Community, Row } from "./data/community.ts";

export async function processMediaMove(
  community: Community,
  media: R2Bucket,
  id: number,
) {
  const move = community.pendingMediaMoves().find((item) => item.id === id);
  if (!move) return;
  const files = community.mediaMoveFiles(id);
  function belongsToMove(object: R2Object | null, file: Row) {
    return (
      object?.customMetadata?.fourm_move === `${id}:${file.media_id}` &&
      object.size === file.size_bytes
    );
  }
  if (move.state === "copying") {
    for (const file of files) {
      let target = await media.head(String(file.new_path));
      const unavailable: string[] = [];
      while (target && !belongsToMove(target, file)) {
        unavailable.push(String(file.new_path));
        file.new_path = community.retargetMediaMoveFile(
          id,
          Number(file.media_id),
          unavailable,
        );
        target = await media.head(file.new_path);
      }
      if (!target) {
        const source = await media.get(String(file.old_path));
        if (!source || source.size !== file.size_bytes) {
          await source?.body.cancel();
          throw new CommunityError(
            503,
            "Original media is unavailable; the move remains recoverable",
          );
        }
        if (source.size > uploadLimit) {
          await source.body.cancel();
          throw new CommunityError(
            503,
            "Media exceeds the existing per-file limit; original bytes are retained",
          );
        }
        // Finish the bounded read before opening a write on the same local R2 authority.
        const bytes = await source.arrayBuffer();
        if (bytes.byteLength !== file.size_bytes)
          throw new CommunityError(503, "Media copy length mismatch");
        const sha256 = Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        )
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
        if (
          source.customMetadata?.archive_sha256 &&
          source.customMetadata.archive_sha256 !== sha256
        )
          throw new CommunityError(
            503,
            "Original media checksum mismatch; bytes are retained",
          );
        target = await media.put(String(file.new_path), bytes, {
          onlyIf: { etagDoesNotMatch: "*" },
          httpMetadata: source.httpMetadata,
          customMetadata: {
            ...source.customMetadata,
            archive_sha256: sha256,
            fourm_last_modified:
              source.customMetadata?.fourm_last_modified ??
              source.uploaded.toISOString(),
            fourm_move: `${id}:${file.media_id}`,
          },
        });
        if (!target) target = await media.head(String(file.new_path));
        if (!belongsToMove(target, file))
          throw new CommunityError(
            409,
            "The media destination changed during rename",
          );
      }
      community.copiedMediaMoveFile(id, Number(file.media_id));
    }
    community.commitMediaMove(id);
  }
  for (const file of files) {
    if (!belongsToMove(await media.head(String(file.new_path)), file))
      throw new CommunityError(
        503,
        "Moved media is unavailable; original bytes are retained",
      );
    await media.delete(String(file.old_path));
  }
  community.finishMediaMove(id);
}

export async function cleanupMediaTransfer(
  community: Community,
  media: R2Bucket,
  transfer: Row,
) {
  const path = String(transfer.storage_path),
    object = await media.head(path);
  if (
    !transfer.upload_id ||
    object?.customMetadata?.fourm_upload === transfer.upload_id
  )
    await media.delete(path);
  community.finishMediaDelete(path);
}
