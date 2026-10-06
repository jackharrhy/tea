document.addEventListener("click", async (event) => {
  const button =
    event.target instanceof Element
      ? event.target.closest("[data-color]")
      : null;
  if (!button) return;
  const text = button.textContent;
  try {
    await navigator.clipboard.writeText(button.dataset.color);
    button.textContent = "Copied!";
  } catch {
    button.textContent = button.dataset.color;
  }
  setTimeout(() => {
    button.textContent = text;
  }, 1200);
});
