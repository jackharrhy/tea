import { marked, Marked, Renderer } from "marked";
import sanitize from "sanitize-html";
import bbcode from "@bbob/html";
import html5 from "@bbob/preset-html5";
import { TagNode, getUniqAttr } from "@bbob/plugin-helper";
const sourceTags = [
  "*",
  "audio",
  "b",
  "center",
  "code",
  "color",
  "hr",
  "i",
  "img",
  "list",
  "quote",
  "s",
  "sub",
  "sup",
  "u",
  "url",
  "video",
];
const preset = html5.extend((tags) => ({
  ...tags,
  url: (node, core, options) => {
    const href = String(getUniqAttr(node.attrs) ?? core.render(node.content));
    if (
      /^(?:javascript|data|vbscript):/i.test(
        href
          .split("")
          .filter((character) => character.charCodeAt(0) > 32)
          .join(""),
      )
    )
      return TagNode.create("span", {}, []);
    return tags.url(node, core, options);
  },
  b: (node) => TagNode.create("strong", {}, node.content),
  i: (node) => TagNode.create("em", {}, node.content),
  u: (node) => TagNode.create("u", {}, node.content),
  s: (node) => TagNode.create("del", {}, node.content),
  sub: (node) => TagNode.create("sub", {}, node.content),
  sup: (node) => TagNode.create("sup", {}, node.content),
  hr: () => TagNode.create("hr", {}, null),
  center: (node) => TagNode.create("div", {}, node.content),
  quote: (node) => TagNode.create("blockquote", {}, node.content),
  code: (node, { render }) =>
    TagNode.create("code", {}, [render(node.content).replaceAll("<br>", "\n")]),
  img: (node, { render }) =>
    TagNode.create("img", { src: render(node.content), alt: "" }, null),
  video: (node, { render }) =>
    TagNode.create("video", { controls: true, src: render(node.content) }, []),
  audio: (node, { render }) =>
    TagNode.create("audio", { controls: true, src: render(node.content) }, []),
}));

const forumMarkdown = new Marked({
  renderer: {
    html(token) {
      return /^<img\b/i.test(token.text.trim())
        ? `<p>${token.text.trim()}</p>\n`
        : token.block
          ? token.text
              .trimEnd()
              .replace(
                /(<\/(?:iframe|p|div|table|blockquote)>)(?=<(?:iframe|p|div|table|blockquote)\b)/g,
                "$1\n",
              ) + "\n\n"
          : token.text;
    },
    image(token) {
      const rendered = Renderer.prototype.image.call(this, token);
      return rendered.replace(
        /^<img src="([^"]*)" alt="([^"]*)"/,
        '<img alt="$2" src="$1"',
      );
    },
  },
});

function bbcodeText(text: string, tag: string) {
  let escaped = text.replaceAll("'", "&#39;").replaceAll('"', "&quot;");
  if (tag === "code") return escaped;
  for (const [source, target] of [
    ["---", "&mdash;"],
    ["--", "&ndash;"],
    ["...", "&#8230;"],
    ["(c)", "&copy;"],
    ["(reg)", "&reg;"],
    ["(tm)", "&trade;"],
  ])
    escaped = escaped.replaceAll(source, target);
  if (tag === "a") return escaped;
  return escaped.replace(
    /\b((?:https?:\/\/|www\d{0,3}\.|[a-z0-9.-]+\.[a-z]{2,4}\/)(?:[^\s()<>]+|\([^\s()<>]+\))+(?:\([^\s()<>]+\)|[^\s`!()[\]{};:'".,<>?]))/gi,
    (url) =>
      `<a href="${/^https?:/i.test(url) ? url : "http://" + url}">${url}</a>`,
  );
}

export function content(source: string, format: string) {
  return format === "markdown"
    ? marked.parse(source, { async: false })
    : source;
}
export function postContent(source: string, format: string) {
  const raw =
    format === "bbcode"
      ? bbcode(
          source
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replace(/\r\n?|\n/g, "<br>")
            .replace(/\[\/?([a-z][a-z0-9]*)[^\]]*\]/gi, (token, tag: string) =>
              sourceTags.includes(tag.toLowerCase())
                ? token
                : "&#91;" + token.slice(1),
            ),
          [preset()],
          {
            onlyAllowTags: sourceTags,
            caseFreeTags: true,
            contextFreeTags: ["code"],
          },
        )
      : format === "html"
        ? source
        : forumMarkdown.parse(source, { async: false });
  const options: sanitize.IOptions & { allowedEmptyAttributes: string[] } = {
    allowedTags: [
      "a",
      "abbr",
      "acronym",
      "b",
      "blockquote",
      "br",
      "code",
      "em",
      "h1",
      "h2",
      "h3",
      "h4",
      "hr",
      "i",
      "img",
      "li",
      "ol",
      "p",
      "pre",
      "s",
      "strong",
      "sub",
      "sup",
      "table",
      "tbody",
      "td",
      "th",
      "thead",
      "tr",
      "u",
      "ul",
      "video",
      "audio",
      "iframe",
    ],
    textFilter: format === "bbcode" ? bbcodeText : undefined,
    allowedEmptyAttributes: ["alt", "allowfullscreen"],
    nonBooleanAttributes: [
      ...sanitize.defaults.nonBooleanAttributes,
      "allowfullscreen",
    ],
    allowedAttributes: {
      a: ["href", "title", "target"],
      img: ["src", "alt", "width", "height"],
      video: ["src", "controls"],
      audio: ["src", "controls"],
      iframe: ["src", "width", "height", "frameborder", "allowfullscreen"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan"],
    },
    allowedSchemes: ["http", "https", "mailto"],
  };
  const sanitized = sanitize(raw, options);
  return (format === "bbcode" ? sanitized : sanitized.trim()).replace(
    /<(img|br|hr)\b((?:"[^"]*"|[^">])*) \/>/g,
    "<$1$2>",
  );
}
