(() => {
  const script = document.currentScript;
  const active = script?.dataset.active === "1";
  const slug = script?.dataset.slug || "~";
  const endpoint = "/tea/admin/visual/" + encodeURIComponent(slug);
  const editor =
    slug === "~"
      ? "/tea/admin/homepage"
      : "/tea/admin/pages/" + encodeURIComponent(slug);
  const fieldUrl = (id) => editor + "?block=" + encodeURIComponent(id);
  const fields = new Map();
  let revision = "";
  let selected;

  const style = document.createElement("style");
  style.textContent = `
    ${active ? "[data-preview-key]:hover { outline: 2px solid #247659 !important; outline-offset: 3px; cursor: pointer }" : ""}
    #tea-visual-bar, #tea-visual-dialog { font: 14px/1.4 Inter, ui-sans-serif, system-ui, sans-serif; color: #183d30 }
    #tea-visual-bar { position: fixed; z-index: 2147483646; bottom: 18px; left: 18px; display: flex; gap: 10px; align-items: center; padding: 9px 12px; border: 1px solid #bdd4c8; border-radius: 9px; background: #f8fbf7; box-shadow: 0 8px 28px #14291d38 }
    #tea-visual-bar a, #tea-visual-dialog a { color: #17694d; text-decoration: underline }
    #tea-visual-dialog { width: min(440px, calc(100vw - 28px)); max-width: none; margin: auto; padding: 20px; border: 1px solid #bdd4c8; border-radius: 10px; background: #f8fbf7; box-shadow: 0 20px 80px #14291d55 }
    #tea-visual-dialog::backdrop { background: #10261e88 }
    #tea-visual-dialog h2 { margin: 0 0 12px; font: 600 18px/1.3 Inter, ui-sans-serif, system-ui, sans-serif; color: #183d30 }
    #tea-visual-dialog textarea { display: block; width: 100%; min-height: 110px; margin: 12px 0; padding: 10px; border: 1px solid #9ebcac; border-radius: 5px; background: white; color: #183d30; font: inherit; resize: vertical }
    #tea-visual-dialog .tea-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center }
    #tea-visual-dialog button { padding: 8px 12px; border: 1px solid #247659; border-radius: 5px; background: #247659; color: white; font: inherit; cursor: pointer }
    #tea-visual-dialog button[disabled] { opacity: .6; cursor: wait }
    #tea-visual-dialog button.tea-secondary { background: transparent; color: #17694d }
    #tea-visual-dialog [role=status] { margin: 10px 0 0; color: #9c3828 }
  `;
  document.head.append(style);

  const bar = document.createElement("div");
  bar.id = "tea-visual-bar";
  const label = document.createElement("strong");
  label.textContent = active ? "🍵 Editing draft" : "🍵 teacms";
  const full = document.createElement("a");
  full.href = editor;
  full.textContent = "Full editor";
  const done = document.createElement("a");
  const clean = new URL(location.href);
  clean.searchParams.delete("tea_edit");
  if (active) {
    done.href = clean.href;
    done.textContent = "Done";
  } else {
    clean.searchParams.set("tea_edit", "1");
    done.href = clean.href;
    done.textContent = "Edit on site";
  }
  bar.append(label, full, done);
  document.body.append(bar);
  if (!active) return;

  const dialog = document.createElement("dialog");
  dialog.id = "tea-visual-dialog";
  const title = document.createElement("h2");
  title.textContent = "Edit this block";
  const input = document.createElement("textarea");
  input.setAttribute("aria-label", "Block text");
  const actions = document.createElement("div");
  actions.className = "tea-actions";
  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "Save draft";
  const open = document.createElement("a");
  open.textContent = "Full editor ↗";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "tea-secondary";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => dialog.close());
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  actions.append(save, open, cancel);
  dialog.append(title, input, actions, status);
  document.body.append(dialog);

  async function refresh() {
    const response = await fetch(endpoint, {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok || response.redirected)
      throw new Error("Sign in to TeaCMS to edit.");
    const data = await response.json();
    revision = data.revision;
    fields.clear();
    for (const field of data.fields) fields.set(field.id, field.text);
  }
  const ready = refresh().catch((error) => {
    label.textContent = error.message;
  });

  for (const element of document.querySelectorAll("[data-preview-key]"))
    if (!element.matches("a, button, input, textarea, select"))
      element.setAttribute("tabindex", "0");

  async function select(element) {
    await ready;
    const id = element.getAttribute("data-preview-key");
    if (!id) return;
    selected = { id, element };
    open.href = fieldUrl(id);
    if (!fields.has(id)) {
      location.href = fieldUrl(id);
      return;
    }
    input.value = fields.get(id);
    status.textContent = "";
    dialog.showModal();
    input.focus();
  }
  document.addEventListener("click", (event) => {
    const element =
      event.target instanceof Element
        ? event.target.closest("[data-preview-key]")
        : null;
    if (!element || dialog.open) return;
    event.preventDefault();
    void select(element);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || !(event.target instanceof Element)) return;
    const element = event.target.closest("[data-preview-key]");
    if (!element || dialog.open) return;
    event.preventDefault();
    void select(element);
  });

  save.addEventListener("click", async () => {
    if (!selected) return;
    save.disabled = true;
    status.textContent = "Saving…";
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ id: selected.id, text: input.value, revision }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Could not save draft.");
      revision = result.revision;
      fields.set(selected.id, input.value);
      selected.element.textContent = input.value;
      dialog.close();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      save.disabled = false;
    }
  });
})();
