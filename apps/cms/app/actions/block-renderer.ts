import { parseAdornmentInstances } from "../features/adornments/public/adornment-instances.ts";
import {
  imageStyle,
  imageGroupStyle,
  decoratedPhotoStyle,
  adornmentStyle,
} from "../ui/public/image-layout.ts";
import { marked } from "marked";
import sanitize from "sanitize-html";
import type {
  ContentBlock,
  Inline,
  Adornment,
} from "../ui/public/content-types.ts";
import { risoColors } from "../features/riso/public/riso-colors.ts";

const escape = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export const mediaUrl = (id: string | null | undefined) =>
  id ? `/tea/api/media/file/${encodeURIComponent(id)}` : "";
function imageDimensions(props: Record<string, unknown>) {
  const width = Number(props.naturalWidth);
  const height = Number(props.naturalHeight);
  return Number.isSafeInteger(width) &&
    Number.isSafeInteger(height) &&
    width > 0 &&
    height > 0
    ? ` width="${width}" height="${height}"`
    : "";
}
function inlineHtml(content: Inline[] = []): string {
  return content
    .map((node) => {
      if (node.type === "link")
        return `<a href="${escape(node.href)}">${inlineHtml(node.content)}</a>`;
      let html = escape(node.text).replace(/\n/g, "<br>");
      const styles = node.styles ?? {};
      for (const [key, tag] of [
        ["bold", "strong"],
        ["italic", "em"],
        ["underline", "u"],
        ["strike", "s"],
        ["code", "code"],
      ])
        if (styles[key]) html = `<${tag}>${html}</${tag}>`;
      const declarations = [];
      if (styles.textColor && styles.textColor !== "default")
        declarations.push(`color:${styles.textColor}`);
      if (styles.backgroundColor && styles.backgroundColor !== "default")
        declarations.push(`background-color:${styles.backgroundColor}`);
      return declarations.length
        ? `<span style="${escape(declarations.join(";"))}">${html}</span>`
        : html;
    })
    .join("");
}
function css(values: Record<string, unknown>) {
  return escape(
    Object.entries(values)
      .filter(([, v]) => v !== "" && v != null)
      .map(([k, v]) => `${k}:${v}`)
      .join(";"),
  );
}
export function renderBlocks(
  blocks: ContentBlock[],
  adornments: Adornment[],
  preview = false,
  options: {
    plainImages?: boolean;
    riso?: boolean;
    priorityImageId?: string;
  } = {},
): string {
  const library = new Map(adornments.map((a) => [a.name, a]));
  function render(items: ContentBlock[]): string {
    let html = "",
      list = "";
    for (const b of items) {
      const next =
        b.type === "bulletListItem"
          ? "ul"
          : b.type === "numberedListItem"
            ? "ol"
            : "";
      if (next !== list) {
        if (list) html += `</${list}>`;
        if (next) html += `<${next}>`;
        list = next;
      }
      const inner = inlineHtml(b.content),
        children = render(b.children ?? []),
        p = b.props;
      const align = ["left", "center", "right", "justify"].includes(
        p.textAlignment,
      )
        ? ` style="text-align:${p.textAlignment}"`
        : "";
      const start = html.length;
      switch (b.type) {
        case "paragraph":
          html += `<p${align}>${inner}</p>${children}`;
          break;
        case "heading": {
          const h = [1, 2, 3, 4, 5, 6].includes(p.level) ? p.level : 2;
          html += `<h${h}${align}>${inner}</h${h}>${children}`;
          break;
        }
        case "bulletListItem":
        case "numberedListItem":
          html += `<li${align}>${inner}${children}</li>`;
          break;
        case "quote":
          html += `<blockquote>${inner}${children}</blockquote>`;
          break;
        case "divider":
          html += "<hr>";
          break;
        case "markdown":
          html += marked.parse(String(p.body ?? ""), { async: false });
          break;
        case "embed": {
          const audio = String(p.url).startsWith("https://w.soundcloud.com/");
          html += `<section class="recording ${audio ? "recording-audio" : "recording-video"}"><div class="recording-caption"><h3>${escape(p.title)}</h3><p>${escape(p.credit)}</p></div><iframe src="${escape(p.url)}" title="${escape(p.title)}" loading="lazy" width="100%" height="${audio ? 300 : 480}" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></section>`;
          break;
        }
        case "media": {
          const priority =
            !!options.priorityImageId && p.mediaId === options.priorityImageId;
          const dimensions = imageDimensions(p);
          if (options.plainImages) {
            html += `<img src="${mediaUrl(p.mediaId)}" alt="${escape(p.alt)}"${p.width ? ` style="width:${escape(p.width)}"` : ""} loading="${priority ? "eager" : "lazy"}"${priority ? ' fetchpriority="high"' : ""}${dimensions}>`;
            break;
          }
          const decorations = (parseAdornmentInstances(p.adornments) ?? [])
            .map((r) => {
              const a = library.get(r.adornmentName);
              return a ? { ...a, css: { ...a.css, ...r.css } } : undefined;
            })
            .filter((a): a is Adornment => !!a?.media_id);
          if (decorations.length) {
            html += `<div class="image-with-adornments" style="${css(imageGroupStyle(p))}"><img src="${mediaUrl(p.mediaId)}" alt="${escape(p.alt)}" style="${css(decoratedPhotoStyle(p))}"${dimensions}>`;
            for (const a of decorations)
              html += `<img class="adornment" src="${mediaUrl(a.media_id)}" alt="" style="${css(adornmentStyle(a.css))}">`;
            html += "</div>";
          } else
            html += `<img src="${mediaUrl(p.mediaId)}" alt="${escape(p.alt)}" style="${css(imageStyle(p))}"${dimensions}>`;
          break;
        }
        case "special":
          if (options.riso !== false && p.type === "riso_colors")
            html += `<div class="riso-colors">${risoColors.map((c) => `<button type="button" data-color="${escape(c.color)}" style="background-color:${escape(c.color)}" aria-label="Copy ${escape(c.name)} color">${escape(c.name)}</button>`).join("")}</div>`;
          break;
        default:
          html += children;
      }
      if (preview && b.type !== "special") {
        html =
          html.slice(0, start) +
          html
            .slice(start)
            .replace(
              /^(<[a-z][\w:-]*)\b/i,
              `$1 data-preview-key="${escape(b.id)}"`,
            );
      }
    }
    if (list) html += `</${list}>`;
    return html;
  }
  return sanitize(render(blocks), {
    allowedTags: [
      ...sanitize.defaults.allowedTags,
      "img",
      "iframe",
      "button",
      "video",
      "audio",
      "source",
    ],
    allowedAttributes: {
      "*": [
        "style",
        "class",
        "id",
        "title",
        "aria-label",
        ...(preview ? ["data-preview-key"] : []),
      ],
      a: ["href", "target", "rel"],
      img: ["src", "alt", "width", "height", "loading", "fetchpriority"],
      iframe: [
        "src",
        "width",
        "height",
        "title",
        "allow",
        "allowfullscreen",
        "frameborder",
        "referrerpolicy",
        "loading",
      ],
      button: ["type", "data-color"],
      video: ["src", "controls", "width", "height", "poster"],
      audio: ["src", "controls"],
      source: ["src", "type"],
    },
    allowedIframeHostnames: [
      "www.youtube.com",
      "www.youtube-nocookie.com",
      "player.vimeo.com",
      "bandcamp.com",
      "w.soundcloud.com",
    ],
    allowedIframeDomains: ["bandcamp.com"],
    allowIframeRelativeUrls: false,
    allowedSchemes: ["http", "https", "mailto", "tel"],
  });
}
