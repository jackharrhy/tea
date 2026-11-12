import { initAdminBanner } from "./lib/admin.ts";
import { initHtmxErrorHandler } from "./lib/csrf.ts";
import { initTimeConversion } from "./lib/time.ts";
import { initPushSubscription } from "./lib/push.ts";
import { initChat } from "./lib/chat.ts";

// These import and self-register on window:
import "./lib/media.ts";
import "./lib/forum.ts";

// Initialize
initHtmxErrorHandler();
initTimeConversion();
initPushSubscription();
initChat();
initAdminBanner();

// Server-rendered editor controls use delegated native events, including fragments.
document.addEventListener("change", (event) => {
  const element = event.target;
  if (!(element instanceof HTMLElement)) return;
  if (element.dataset.editorId && element.dataset.editorLang)
    window.switchEditorLang?.(
      element.dataset.editorId,
      element.dataset.editorLang,
    );
  if (element instanceof HTMLSelectElement && element.dataset.mediaEditor)
    window.updateMediaButtons(element.dataset.mediaEditor);
});
document.addEventListener("click", (event) => {
  const button =
    event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>(
          "button[data-media-insert],button[data-media-upload]",
        )
      : null;
  if (!button) return;
  if (button.dataset.mediaInsert && button.dataset.mediaEditor)
    window.insertMediaSnippet(
      button.dataset.mediaEditor,
      button.dataset.mediaInsert,
    );
  if (button.dataset.mediaUpload)
    window.quickUploadMedia(
      button.dataset.mediaUpload,
      button.dataset.mediaFormat ?? "html",
    );
});
