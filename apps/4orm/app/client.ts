const log = document.querySelector<HTMLElement>("[data-chat-log]");
const form = document.querySelector<HTMLFormElement>("[data-chat-form]");
if (log && form) {
  let cursor = Number(log.dataset.cursor ?? 0);
  const status = document.querySelector<HTMLElement>("[data-chat-status]")!;
  const messages = new EventSource(`/chat/stream?after=${cursor}`);
  messages.addEventListener("message", (event: MessageEvent) => {
    const message = JSON.parse(event.data);
    if (!Number.isSafeInteger(message.id) || message.id <= cursor) return;
    cursor = message.id;
    const row = document.createElement("p");
    const author = document.createElement("a");
    author.href = `/u/${encodeURIComponent(message.username)}`;
    author.textContent = message.display_name;
    row.appendChild(author);
    row.appendChild(document.createTextNode(`: ${message.message}`));
    log.appendChild(row);
    while (log.children.length > 200) log.firstElementChild?.remove();
    status.textContent = "Connected";
  });
  messages.addEventListener("unavailable", () => {
    messages.close();
    status.textContent = "Sign in again or refresh to reconnect.";
  });
  messages.addEventListener("presence", (event: MessageEvent) => {
    const present = document.querySelector<HTMLElement>("[data-chat-presence]");
    if (present)
      present.textContent =
        "Here now: " +
        JSON.parse(event.data)
          .map((member: { display_name: string }) => member.display_name)
          .join(", ");
  });
  messages.addEventListener("error", () => {
    status.textContent = "Reconnecting…";
  });
  messages.addEventListener("open", () => {
    status.textContent = "Connected";
  });
  let phase: "idle" | "sending" | "failed" = "idle";
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (phase === "sending") return;
    phase = "sending";
    const button = form.querySelector<HTMLButtonElement>("button")!;
    button.disabled = true;
    status.textContent = "Sending…";
    try {
      const response = await fetch(form.action, {
        method: "POST",
        body: new FormData(form),
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("Send failed");
      form.reset();
      phase = "idle";
      status.textContent = "Sent";
    } catch {
      phase = "failed";
      status.textContent = "Message was not sent. Try again.";
    } finally {
      button.disabled = false;
    }
  });
  addEventListener("pagehide", () => messages.close(), { once: true });
}
