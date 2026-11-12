import { marked } from "marked";
import sanitize from "sanitize-html";
import bbcode from "@bbob/html";
import html5 from "@bbob/preset-html5";
import { TagNode } from "@bbob/plugin-helper";
const preset = html5.extend((tags) => ({
  ...tags,
  video: (node, { render }) =>
    TagNode.create("video", { src: render(node.content), controls: true }, []),
  audio: (node, { render }) =>
    TagNode.create("audio", { src: render(node.content), controls: true }, []),
}));

export function content(source: string, format: string) {
  return format === "markdown"
    ? marked.parse(source, { async: false })
    : source;
}
export function postContent(source: string, format: string) {
  const raw =
    format === "bbcode"
      ? bbcode(source, [preset()])
      : format === "html"
        ? source
        : marked.parse(source, { async: false });
  return sanitize(raw, {
    allowedTags: [
      ...sanitize.defaults.allowedTags,
      "img",
      "video",
      "audio",
      "iframe",
      "span",
    ],
    allowedAttributes: {
      a: ["href", "title", "target"],
      img: ["src", "alt", "width", "height"],
      video: ["src", "controls"],
      audio: ["src", "controls"],
      iframe: ["src", "width", "height", "allowfullscreen"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan"],
      span: ["style"],
    },
    allowedStyles: {
      span: {
        "font-weight": [/^bold$/],
        "font-style": [/^italic$/],
        "text-decoration": [/^(underline|line-through)$/],
        color: [/^#[a-f0-9]{3,8}$/i, /^[a-z]+$/i],
      },
    },
    allowedSchemes: ["http", "https", "mailto"],
  });
}
