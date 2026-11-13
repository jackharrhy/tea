import { Renderer } from "marked";
import type { Marked, Token } from "marked";

type Attributes = Map<string, string | null>;
function attributes(source: string): Attributes | null {
  const result: Attributes = new Map();
  const scanner =
    /([^ =}]+)="([^"]*)"|([^ =}]+)='([^']*)'|([^ =}]+)=([^ =}]+)|([^ =}]+)/y;
  let position = 0;
  while (position < source.length) {
    if (source[position] === " ") {
      position++;
      continue;
    }
    scanner.lastIndex = position;
    const match = scanner.exec(source);
    if (!match) return null;
    let name = match[1] ?? match[3] ?? match[5] ?? match[7];
    let value = match[2] ?? match[4] ?? match[6] ?? null;
    if (match[7]?.startsWith(".")) {
      name = "class";
      value = [result.get("class"), match[7].slice(1)]
        .filter(Boolean)
        .join(" ");
    } else if (match[7]?.startsWith("#")) {
      name = "id";
      value = match[7].slice(1);
    }
    name = name.replace(
      // oxlint-disable-next-line no-misleading-character-class -- Python attr_list permits combining marks in XML names.
      /[^A-Z_a-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u02ff\u0370-\u037d\u037f-\u1fff\u200c-\u200d\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd:\-.0-9\u00b7\u0300-\u036f\u203f-\u2040]+/g,
      "_",
    );
    result.set(name, value);
    position = scanner.lastIndex;
  }
  return result.size ? result : null;
}
function escape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
function apply(html: string, attrs: Attributes) {
  return html.replace(
    /^<([a-z][a-z0-9]*)([^>]*?)(\/?)>/i,
    (_, tag: string, existing: string, closing: string) => {
      for (const [name, value] of attrs) {
        const literal = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        existing = existing.replace(
          new RegExp(
            `\\s+${literal}(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+))?(?=\\s|$)`,
            "gi",
          ),
          "",
        );
        existing += value === null ? ` ${name}` : ` ${name}="${escape(value)}"`;
      }
      return `<${tag}${existing}${closing}>`;
    },
  );
}
export function markdownAttributes(markdown: Marked) {
  const assigned = new WeakMap<object, Attributes>();
  function visit(tokens: Token[]) {
    for (const token of tokens) {
      if (token.type === "list")
        for (const item of token.items) visit(item.tokens);
      if (!("tokens" in token) || !Array.isArray(token.tokens)) continue;
      const children = token.tokens as Token[];
      const last = children.at(-1);
      if (
        (token.type === "heading" || token.type === "paragraph") &&
        last?.type === "text"
      ) {
        const pattern =
          token.type === "heading"
            ? / +\{:? *([^}\n ][^\n]*)\} *$/
            : /\n *\{:? *([^}\n ][^\n]*)\} *$/;
        const match = pattern.exec(last.text);
        const parsed = match && attributes(match[1]);
        if (parsed) {
          assigned.set(token, parsed);
          last.text = last.text.slice(0, match.index);
          if (token.type === "heading")
            last.text = last.text.replace(/#+$/, "").trimEnd();
        }
      }
      visit(children);
      for (let i = 1; i < children.length; i++) {
        const previous = children[i - 1],
          following = children[i];
        if (
          !["image", "link", "strong", "em", "codespan"].includes(
            previous.type,
          ) ||
          following.type !== "text"
        )
          continue;
        const match = /^\{:? *([^}\n ][^\n]*)\}/.exec(following.text);
        const parsed = match && attributes(match[1]);
        if (parsed) {
          assigned.set(previous, parsed);
          following.text = following.text.slice(match[0].length);
        }
      }
    }
  }
  const renderer = markdown.defaults.renderer ?? new Renderer();
  const wrap = <T extends object>(
    render: (this: Renderer, token: T) => string,
  ) =>
    function (this: Renderer, token: T) {
      const html = render.call(this, token),
        attrs = assigned.get(token);
      return attrs ? apply(html, attrs) : html;
    };
  markdown.use({
    hooks: {
      processAllTokens(tokens) {
        visit(tokens);
        return tokens;
      },
    },
    renderer: {
      heading: wrap(renderer.heading),
      paragraph: wrap(renderer.paragraph),
      image: wrap(renderer.image),
      link: wrap(renderer.link),
      strong: wrap(renderer.strong),
      em: wrap(renderer.em),
      codespan: wrap(renderer.codespan),
    },
  });
}
