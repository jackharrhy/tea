import { createContextKey, type Middleware } from "remix/router";

import type { AttachmentStore } from "../data/attachment-store.ts";

export const attachmentStoreContext = createContextKey<AttachmentStore>();

export function loadAttachmentStore(
  store: AttachmentStore,
): Middleware<{ key: typeof attachmentStoreContext; value: AttachmentStore }> {
  return (context, next) => {
    context.set(attachmentStoreContext, store);
    return next();
  };
}
