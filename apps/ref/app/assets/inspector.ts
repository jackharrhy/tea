import type { BoardItem, LinkPreview } from "../data/protocol.ts";

export function displaySiteName(link: LinkPreview): string {
  const host = new URL(link.url).hostname.replace(/^www\./, "");
  return host === "x.com" || host === "twitter.com" ? "Twitter" : link.siteName;
}

export function displayFilename(filename: string): string {
  return filename.startsWith("Media posts by ")
    ? filename.replace(/ X(\.[^.]+)$/i, " Twitter$1")
    : filename;
}

export function renderItemInspector(
  panel: HTMLElement,
  content: HTMLElement,
  item: BoardItem | null,
  boardId: string,
  onRemove: () => void,
) {
  if (!item) {
    panel.hidden = true;
    content.dataset.itemId = "";
    return;
  }
  panel.hidden = false;
  const heading = panel.querySelector<HTMLElement>(".inspector-top span");
  if (heading) heading.textContent = item.link ? "Link" : "Image";
  if (item.link && content.dataset.itemId === item.id) return;
  if (content.dataset.itemId !== item.id) panel.scrollTop = 0;
  content.dataset.itemId = item.id;
  content.replaceChildren();
  if (item.link) renderLinkInspector(content, item.link);
  else renderImageInspector(content, item, boardId);

  const remove = document.createElement("button");
  remove.className = "danger-button";
  remove.type = "button";
  remove.textContent = item.link ? "Remove link" : "Remove image";
  remove.addEventListener("click", onRemove);
  content.appendChild(remove);
}

function renderImageInspector(
  content: HTMLElement,
  item: BoardItem,
  boardId: string,
) {
  const image = document.createElement("img");
  image.className = "inspector-preview";
  image.alt = displayFilename(item.filename);
  image.decoding = "async";
  const originalSize = document.createElement("strong");
  originalSize.textContent = "—";
  image.addEventListener("load", () => {
    originalSize.textContent = `${image.naturalWidth} × ${image.naturalHeight} px`;
  });
  image.src = `/media/${boardId}/${item.assetId}`;
  content.appendChild(image);
  content.appendChild(originalLink(image.src));

  const title = document.createElement("h3");
  title.textContent = displayFilename(item.filename);
  content.appendChild(title);
  content.appendChild(propertyRow("Original size", originalSize));
  for (const [key, value] of [
    ["Board width", `${Math.round(item.width)} px`],
    ["Board height", `${Math.round(item.height)} px`],
    ["Rotation", `${Math.round(item.rotation)}°`],
    ["Layer", String(item.z)],
  ]) {
    content.appendChild(propertyRow(key, value));
  }
}

function propertyRow(key: string, value: string | HTMLElement): HTMLElement {
  const row = document.createElement("div");
  row.className = "property-row";
  const label = document.createElement("span");
  label.textContent = key;
  const strong =
    typeof value === "string" ? document.createElement("strong") : value;
  if (typeof value === "string") strong.textContent = value;
  row.appendChild(label);
  row.appendChild(strong);
  return row;
}

function originalLink(href: string): HTMLAnchorElement {
  const open = document.createElement("a");
  open.className = "open-original";
  open.href = href;
  open.target = "_blank";
  open.rel = "noopener noreferrer";
  open.textContent = "Open original ↗";
  return open;
}

function renderLinkInspector(content: HTMLElement, link: LinkPreview) {
  if (link.imageUrl) {
    const image = document.createElement("img");
    image.className = "link-inspector-image";
    image.src = link.imageUrl;
    image.alt = displaySiteName(link);
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => image.remove());
    content.appendChild(image);
  }
  content.appendChild(originalLink(link.url));

  const metadata = document.createElement("div");
  metadata.className = "link-metadata";
  const site = document.createElement("span");
  site.className = "link-card-site";
  site.textContent = displaySiteName(link);
  const title = document.createElement("h3");
  title.textContent = displaySiteName(link) === "Twitter" ? "Post" : link.title;
  metadata.appendChild(site);
  metadata.appendChild(title);
  if (link.description) {
    const description = document.createElement("p");
    description.className = "link-inspector-description";
    description.textContent = link.description;
    metadata.appendChild(description);
  }
  content.appendChild(metadata);

  const embed = embedFor(link.url);
  if (!embed) return;
  const button = document.createElement("button");
  button.className = "original-embed-button";
  button.type = "button";
  button.textContent = `View ${embed.title}`;
  button.setAttribute("aria-expanded", "false");
  const frame = document.createElement("iframe");
  frame.className = "link-embed";
  frame.hidden = true;
  frame.title = embed.title;
  frame.loading = "lazy";
  frame.referrerPolicy = "no-referrer";
  frame.allow = "fullscreen; encrypted-media; picture-in-picture";
  if (embed.title === "YouTube video") frame.classList.add("video-embed");
  button.addEventListener("click", () => {
    frame.hidden = !frame.hidden;
    button.setAttribute("aria-expanded", String(!frame.hidden));
    button.textContent = `${frame.hidden ? "View" : "Hide"} ${embed.title}`;
    if (!frame.hidden && !frame.hasAttribute("src")) frame.src = embed.url;
  });
  content.appendChild(button);
  content.appendChild(frame);
}

function embedFor(value: string): { url: string; title: string } | null {
  const url = new URL(value);
  const host = url.hostname.replace(/^www\./, "");
  if (host === "x.com" || host === "twitter.com") {
    const id = /\/(?:i\/web\/)?status\/(\d+)/.exec(url.pathname)?.[1];
    if (id)
      return {
        url: `https://platform.twitter.com/embed/Tweet.html?id=${id}&dnt=true`,
        title: "Twitter post",
      };
  }
  if (
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "youtu.be"
  ) {
    const id =
      host === "youtu.be"
        ? url.pathname.slice(1)
        : (url.searchParams.get("v") ??
          /\/shorts\/([^/]+)/.exec(url.pathname)?.[1]);
    if (id && /^[A-Za-z0-9_-]{11}$/.test(id))
      return {
        url: `https://www.youtube-nocookie.com/embed/${id}`,
        title: "YouTube video",
      };
  }
  if (host === "instagram.com") {
    const match = /^\/(p|reel)\/([A-Za-z0-9_-]+)/.exec(url.pathname);
    if (match)
      return {
        url: `https://www.instagram.com/${match[1]}/${match[2]}/embed/captioned/`,
        title: "Instagram post",
      };
  }
  return null;
}
