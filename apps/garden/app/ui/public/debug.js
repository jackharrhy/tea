document
  .querySelector("[data-compare-note]")
  ?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const status = form.querySelector('[role="status"]');
    try {
      const response = await fetch(form.action, {
        method: "POST",
        body: new FormData(form),
      });
      if (!response.ok) throw new Error("Save failed");
      status.textContent = "Saved";
    } catch {
      status.textContent = "Could not save note";
    }
  });
