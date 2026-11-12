import { validSpeechText } from "@harrhy/gurgur-engine";
import type { PlayerInput } from "./input";

export type SpeechChat = {
  setEnabled(enabled: boolean): void;
  rejected(retryAfterMs: number, worldChanged: boolean): void;
  dispose(): void;
};

export function installSpeechChat(options: {
  form: HTMLFormElement;
  field: HTMLInputElement;
  status: HTMLOutputElement;
  input: PlayerInput;
  submit(requestId: number, text: string): boolean;
}): SpeechChat {
  const { form, field, status, input } = options;
  let enabled = false;
  let active = false;
  let requestId = 0;
  let statusTimer: number | null = null;

  const hideStatus = (): void => {
    if (statusTimer !== null) clearTimeout(statusTimer);
    statusTimer = null;
    status.hidden = true;
    status.textContent = "";
  };
  const showStatus = (message: string, timeoutMs = 0): void => {
    if (statusTimer !== null) clearTimeout(statusTimer);
    status.textContent = message;
    status.hidden = false;
    statusTimer =
      timeoutMs > 0
        ? window.setTimeout(() => {
            statusTimer = null;
            status.hidden = true;
            status.textContent = "";
          }, timeoutMs)
        : null;
  };
  const close = (restorePointer: boolean): void => {
    if (!active) return;
    active = false;
    form.hidden = true;
    document.body.dataset.speechChat = "closed";
    input.setTextEntryActive(false);
    if (restorePointer) input.requestPointerLock();
  };
  const open = (): void => {
    if (!enabled || active) return;
    active = true;
    hideStatus();
    field.value = "";
    form.hidden = false;
    document.body.dataset.speechChat = "open";
    input.setTextEntryActive(true);
    if (document.pointerLockElement) document.exitPointerLock();
    field.focus({ preventScroll: true });
  };
  const keyDown = (event: KeyboardEvent): void => {
    if (
      !active &&
      enabled &&
      !event.repeat &&
      event.code === "KeyT" &&
      !(event.target instanceof HTMLInputElement)
    ) {
      event.preventDefault();
      open();
    }
  };
  const fieldKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== "Escape") return;
    event.preventDefault();
    close(true);
  };
  const inputChanged = (): void => hideStatus();
  const submitted = (event: SubmitEvent): void => {
    event.preventDefault();
    const text = field.value.trim();
    if (!validSpeechText(text)) {
      if (text.includes("[[")) showStatus("Speech commands are not allowed.");
      else if (!/^[\x20-\x7e]*$/.test(text))
        showStatus("Speech supports printable English text only.");
      else showStatus("Enter between 1 and 120 characters.");
      return;
    }
    const nextRequestId = requestId++;
    if (!options.submit(nextRequestId, text)) {
      showStatus("Speech is unavailable while disconnected.");
      return;
    }
    document.body.dataset.lastSpeechRequest = String(nextRequestId);
    close(true);
  };

  document.body.dataset.speechChat = "closed";
  addEventListener("keydown", keyDown);
  field.addEventListener("keydown", fieldKeyDown);
  field.addEventListener("input", inputChanged);
  form.addEventListener("submit", submitted);

  return {
    setEnabled(nextEnabled) {
      enabled = nextEnabled;
      if (!enabled) close(false);
    },
    rejected(retryAfterMs, worldChanged) {
      showStatus(
        worldChanged
          ? "The world changed before that could be spoken."
          : `Slow down — speech is available in ${Math.max(1, Math.ceil(retryAfterMs / 1_000))}s.`,
        2_000,
      );
    },
    dispose() {
      close(false);
      hideStatus();
      removeEventListener("keydown", keyDown);
      field.removeEventListener("keydown", fieldKeyDown);
      field.removeEventListener("input", inputChanged);
      form.removeEventListener("submit", submitted);
    },
  };
}
