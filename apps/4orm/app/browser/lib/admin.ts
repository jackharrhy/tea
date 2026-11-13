export function initAdminBanner() {
  const html = document.getElementById("site-banner-html"),
    css = document.getElementById("site-banner-css"),
    preview = document.getElementById("site-banner-preview");
  if (
    !(html instanceof HTMLTextAreaElement) ||
    !(css instanceof HTMLTextAreaElement) ||
    !(preview instanceof HTMLIFrameElement)
  )
    return;
  const update = () => {
    preview.srcdoc = `<!doctype html><style>
 body { margin: 0; padding: 10px; }
 .site-banner { padding: 10px 14px; border: 2px solid #333; background: #ffffcc; color: #111; text-align: center; }
 ${css.value}
 </style><aside class="site-banner">${html.value}</aside>`;
  };
  html.addEventListener("input", update);
  css.addEventListener("input", update);
  update();
}

const observedLabels = new WeakSet<HTMLElement>();
export function initAdminRows() {
  for (const label of document.querySelectorAll<HTMLElement>(
    ".fourm-admin-row > summary > label",
  )) {
    if (observedLabels.has(label)) continue;
    label.addEventListener("click", (event) => event.stopPropagation());
    observedLabels.add(label);
  }
}
