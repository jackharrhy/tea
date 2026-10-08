import { access } from "node:fs/promises";

import { openLazyFile } from "remix/fs";
import {
  FormDataParseError,
  MaxFilesExceededError,
  MaxFileSizeExceededError,
  MaxPartsExceededError,
  MaxTotalSizeExceededError,
  parseFormData,
  type FileUpload,
} from "remix/form-data-parser";
import { createController } from "remix/router";

import {
  AttachmentUploadError,
  MAX_UPLOAD_BYTES,
  type StoredAttachment,
} from "../../data/attachment-store.ts";
import { isSiteEnabled } from "../../data/site-settings.ts";
import { attachmentStoreContext } from "../../middleware/attachments.ts";
import { databaseContext } from "../../middleware/database.ts";
import { routes } from "../../routes.ts";
import { getSteveAccess } from "../steve/auth.ts";

const draftTokenPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default createController(routes.uploads, {
  actions: {
    async create(context) {
      let originRejection = rejectCrossOrigin(context.request);
      if (originRejection) return originRejection;

      let database = context.get(databaseContext);
      if (!(await isSiteEnabled(database))) {
        return jsonError("Letters are closed right now.", 503);
      }

      let draftToken = context.request.headers.get("x-draft-token") ?? "";
      if (!draftTokenPattern.test(draftToken)) {
        return jsonError(
          "Reload the writing page before adding an image.",
          400,
        );
      }

      let store = context.get(attachmentStoreContext);
      let stored: StoredAttachment | null = null;

      try {
        await parseFormData(
          context.request,
          {
            maxFiles: 1,
            maxFileSize: MAX_UPLOAD_BYTES,
            maxParts: 2,
            maxTotalSize: MAX_UPLOAD_BYTES + 64 * 1024,
          },
          async (file: FileUpload) => {
            if (file.fieldName !== "image" || stored) return null;
            stored = await store.create(file, draftToken);
            return stored.id;
          },
        );

        let completed = stored as StoredAttachment | null;
        if (!completed) return jsonError("Choose an image to add.", 400);
        return Response.json(completed, { status: 201 });
      } catch (error) {
        let completed = stored as StoredAttachment | null;
        if (completed) await store.removeUnclaimed(completed.id, draftToken);
        if (error instanceof AttachmentUploadError) {
          return jsonError(error.message, error.status);
        }
        if (
          error instanceof MaxFileSizeExceededError ||
          error instanceof MaxTotalSizeExceededError
        ) {
          return jsonError("Each image must be 10 MB or smaller.", 413);
        }
        if (
          error instanceof MaxFilesExceededError ||
          error instanceof MaxPartsExceededError
        ) {
          return jsonError("Upload one image at a time.", 400);
        }
        if (error instanceof FormDataParseError) {
          return jsonError("That upload could not be read.", 400);
        }
        throw error;
      }
    },

    async show(context) {
      let id = context.params.attachmentId?.toLowerCase() ?? "";
      if (!draftTokenPattern.test(id))
        return new Response("Image not found.", { status: 404 });

      let database = context.get(databaseContext);
      if (
        !(await isSiteEnabled(database)) &&
        getSteveAccess(context.request) !== "authorized"
      ) {
        return new Response("Image not found.", { status: 404 });
      }

      let store = context.get(attachmentStoreContext);
      let attachment = await store.find(id);
      if (!attachment) return new Response("Image not found.", { status: 404 });

      try {
        await access(store.pathFor(attachment));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return new Response("Image not found.", { status: 404 });
        }
        throw error;
      }

      let file = openLazyFile(store.pathFor(attachment), {
        name: attachment.storage_key,
        type: attachment.mime_type,
      });

      return new Response(file.stream(), {
        headers: {
          // Every request must reach the availability gate so switching the site
          // off also revokes direct attachment URLs.
          "Cache-Control": "private, no-cache",
          "Content-Length": String(attachment.byte_size),
          "Content-Type": attachment.mime_type,
          "X-Content-Type-Options": "nosniff",
        },
      });
    },
  },
});

function rejectCrossOrigin(request: Request): Response | null {
  let origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return jsonError("Cross-origin uploads are not allowed.", 403);
  }
  return null;
}

function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status });
}
