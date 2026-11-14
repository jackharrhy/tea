import fs from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { fromHtml } from "hast-util-from-html";
import { visit } from "unist-util-visit";
import { parse, walk } from "css-tree";
import parseSrcset from "parse-srcset";
import { createContentStore } from "./store.ts";
import { createMarkdownRenderer } from "./markdown.ts";
import { resolveOgImage } from "./utils.ts";

export interface PublicAsset {
  sourcePath: string;
  hash: string;
  bytes: number;
  contents: Buffer;
}
export interface PublicAssetOptions {
  vaultPath: string;
  assetsPath: string;
  assetOrigin?: string;
  origin?: string;
  approvedPublic?: string[];
}

export async function readApprovedPublic(file?: string): Promise<string[]> {
  if (!file) return [];
  const value: unknown = JSON.parse(
    await fs.readFile(path.resolve(file), "utf8"),
  );
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
    throw new Error(
      "Public selection must be a JSON array of explicitly approved asset-relative paths",
    );
  return value;
}

function assetPath(value: string) {
  if (!value || value.startsWith("/") || value.includes("\\"))
    throw new Error("Invalid public asset path");
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code < 32 || code === 127) throw new Error("Invalid public asset path");
  }
  const normalized = path.posix.normalize(value);
  if (normalized.split("/").some((part) => part.startsWith(".")))
    throw new Error(
      "Public asset path escapes the asset directory or is hidden",
    );
  return normalized;
}

// This is the selection owner for export and upload. References are extracted
// from the same rendered Markdown used by pages, never from a second Markdown parser.
export async function selectPublicAssets(options: PublicAssetOptions) {
  const snapshot = createContentStore(options.vaultPath).read();
  if (!snapshot.byId.has("home"))
    throw new Error("A public Home.md is required");
  const root = await fs.realpath(options.assetsPath);
  const cdn = new URL(options.assetOrigin || "https://garden.jack.camera/");
  const site = new URL(options.origin || "https://jackharrhy.dev/");
  const pending = new Set<string>();
  const executable = new Set<string>();
  const approved = new Set((options.approvedPublic || []).map(assetPath));
  const selected = new Map<string, PublicAsset>();

  function collect(input: string, base?: string, resource = false) {
    const value = input.trim();
    if (!value || value.startsWith("#") || value.startsWith("?")) return;
    let local: string;
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value)) {
      const url = new URL(value, cdn);
      const prefix =
        url.origin === cdn.origin
          ? cdn.pathname.replace(/\/$/, "") + "/"
          : url.origin === site.origin
            ? "/asset/"
            : undefined;
      if (!prefix || !url.pathname.startsWith(prefix)) return;
      local = decodeURIComponent(url.pathname.slice(prefix.length));
    } else {
      const pathname = decodeURIComponent(value.split(/[?#]/, 1)[0]);
      if (pathname.startsWith("/asset/")) local = pathname.slice(7);
      else if (base)
        local = pathname.startsWith("/")
          ? pathname.slice(1)
          : path.posix.join(path.posix.dirname(base), pathname);
      else {
        if (resource && !pathname.startsWith("/"))
          throw new Error(
            "Relative page media must use an explicit /asset/ URL",
          );
        return;
      }
    }
    const reference = assetPath(local);
    pending.add(reference);
    return reference;
  }

  function css(source: string, base?: string, inline = false) {
    const tree = parse(source, {
      context: inline ? "declarationList" : "stylesheet",
      parseCustomProperty: true,
      onParseError(error) {
        throw error;
      },
    });
    walk(tree, (node) => {
      if (
        node.type === "Raw" ||
        ((node.type === "Function" || node.type === "Atrule") &&
          node.name.includes("\\"))
      )
        throw new Error("Unsupported CSS in public asset dependencies");
      if (node.type === "Url") collect(node.value, base, true);
      if (node.type === "Atrule" && node.name.toLowerCase() === "import") {
        const target = node.prelude?.children?.first;
        if (target?.type === "String") collect(target.value, base, true);
      }
      if (
        node.type === "Function" &&
        /^(?:-webkit-)?image-set$/i.test(node.name)
      )
        throw new Error(
          "Use url() dependencies instead of CSS image-set() in published assets",
        );
    });
  }

  function html(source: string, base?: string) {
    const tree = fromHtml(source, { fragment: base === undefined });
    visit(tree, "element", (node) => {
      const approvedDocument = base !== undefined && approved.has(base);
      const scriptType =
        typeof node.properties.type === "string"
          ? node.properties.type.trim().toLowerCase()
          : "";
      const executableScript =
        node.tagName === "script" &&
        !["application/json", "application/ld+json"].includes(scriptType);
      if (
        !approvedDocument &&
        (Object.keys(node.properties).some((key) => /^on[a-z]/i.test(key)) ||
          (executableScript &&
            node.children.some(
              (child) => child.type === "text" && child.value.trim(),
            )))
      )
        throw new Error(
          "Inline scripts require an explicitly approved asset document; inline page scripts are unsupported",
        );
      if (node.tagName === "base" || node.properties.srcDoc !== undefined)
        throw new Error(
          "HTML base and srcdoc are unsupported in public asset dependencies",
        );
      const attributes: string[] = [];
      if (
        [
          "audio",
          "embed",
          "iframe",
          "img",
          "input",
          "source",
          "track",
          "video",
        ].includes(node.tagName)
      )
        attributes.push("src");
      if (
        [
          "a",
          "area",
          "link",
          "use",
          "image",
          "feImage",
          "linearGradient",
          "radialGradient",
          "pattern",
          "textPath",
          "mpath",
        ].includes(node.tagName)
      )
        attributes.push("href", "xLinkHref");
      if (executableScript) attributes.push("src", "href", "xLinkHref");
      if (node.tagName === "video") attributes.push("poster");
      if (node.tagName === "object") attributes.push("data");
      if (["body", "table", "td", "th"].includes(node.tagName))
        attributes.push("background");
      for (const key of attributes) {
        const value = node.properties[key];
        if (typeof value === "string") {
          const reference = collect(
            value,
            base,
            key !== "href" && key !== "xLinkHref",
          );
          if (executableScript && reference) executable.add(reference);
        }
      }
      const srcsets =
        node.tagName === "link"
          ? ["imageSrcSet"]
          : ["img", "source"].includes(node.tagName)
            ? ["srcSet"]
            : [];
      for (const key of srcsets) {
        const value = node.properties[key];
        if (typeof value === "string")
          for (const item of parseSrcset(value)) collect(item.url, base, true);
      }
      for (const key of [
        "fill",
        "stroke",
        "filter",
        "mask",
        "clipPath",
        "cursor",
        "marker",
        "markerStart",
        "markerMid",
        "markerEnd",
        "colorProfile",
      ]) {
        const value = node.properties[key];
        if (typeof value === "string") {
          const property = key.replace(
            /[A-Z]/g,
            (letter) => `-${letter.toLowerCase()}`,
          );
          css(`${property}:${value}`, base, true);
        }
      }
      const style = node.properties.style;
      if (typeof style === "string") css(style, base, true);
      if (node.tagName === "style")
        css(
          node.children
            .filter((child) => child.type === "text")
            .map((child) => child.value)
            .join(""),
          base,
        );
    });
  }

  const render = createMarkdownRenderer(snapshot.index);
  for (const entry of snapshot.entries) {
    if (
      /^linkblog\/\d{4}\/\d{2}\/\d{2}$/.test(entry.id) &&
      (!entry.data.description?.trim() || !entry.data["og-image"]?.trim())
    )
      throw new Error(
        "Public linkblog entries require description and og-image",
      );
    const image = resolveOgImage(entry.data["og-image"]);
    if (image) collect(image, undefined, true);
    for (const segment of await render(entry.body)) {
      if (segment.type === "prose") html(segment.html);
      else if (segment.props.component === "Project") {
        if (segment.props.image) collect(segment.props.image, undefined, true);
        if (segment.props.link) collect(segment.props.link);
      }
    }
  }
  for (const reference of approved) pending.add(reference);
  for (const reference of pending) {
    if (selected.has(reference)) continue;
    const file = await fs.realpath(path.join(root, reference));
    if (!file.startsWith(root + path.sep))
      throw new Error("Public asset escapes the configured directory");
    const handle = await fs.open(
      file,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    let contents: Buffer;
    try {
      if (!(await handle.stat()).isFile())
        throw new Error("Public asset must be a regular file");
      contents = await handle.readFile();
    } finally {
      await handle.close();
    }
    selected.set(reference, {
      sourcePath: reference,
      hash: createHash("sha256").update(contents).digest("hex"),
      bytes: contents.length,
      contents,
    });
    const extension = path.extname(reference).toLowerCase();
    if (extension === ".css") css(contents.toString("utf8"), reference);
    if ([".html", ".htm", ".svg"].includes(extension))
      html(contents.toString("utf8"), reference);
  }
  for (const reference of selected.keys()) {
    if (
      (executable.has(reference) ||
        [".js", ".mjs", ".cjs"].includes(
          path.extname(reference).toLowerCase(),
        )) &&
      !approved.has(reference)
    )
      throw new Error(
        "Executable script assets require explicit public selection; their dependencies are not inferred",
      );
  }
  return {
    snapshot,
    assets: [...selected.values()].toSorted((a, b) =>
      a.sourcePath.localeCompare(b.sourcePath),
    ),
  };
}
