import type { Handle, RemixNode } from "remix/component";

import { fontKeys, type FontKey } from "../data/schema.ts";

export const MAX_LETTER_CHARACTERS = 5000;
export const MAX_RICH_TEXT_BYTES = 100 * 1024;
export const MAX_IMAGES_PER_LETTER = 10;

const attachmentPathPattern =
  /^\/uploads\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

type RichMark =
  | { type: "bold" }
  | { type: "italic" }
  | { type: "link"; attrs: { href: string } };

export interface RichTextNode {
  type:
    | "doc"
    | "paragraph"
    | "text"
    | "hardBreak"
    | "blockquote"
    | "bulletList"
    | "listItem"
    | "image";
  attrs?: {
    alt?: string;
    height?: number;
    href?: string;
    src?: string;
    width?: number;
  };
  content?: RichTextNode[];
  marks?: RichMark[];
  text?: string;
}

export interface NormalizedRichText {
  attachmentIds: string[];
  document: RichTextNode;
  json: string;
  text: string;
}

interface RichTextProps {
  className?: string;
  fallback: string;
  fontKey?: string;
  json?: string | null;
}

export class RichTextValidationError extends Error {}

export function normalizeFontKey(value: string): FontKey {
  return fontKeys.includes(value as FontKey)
    ? (value as FontKey)
    : "handwritten";
}

export function normalizeRichText(input: {
  allowEmpty?: boolean;
  allowImages?: boolean;
  fallback: string;
  json?: string | null;
}): NormalizedRichText {
  let fallback = input.fallback.trim();
  let document: RichTextNode;

  if (input.json && input.json.trim() !== "") {
    if (Buffer.byteLength(input.json, "utf8") > MAX_RICH_TEXT_BYTES) {
      throw new RichTextValidationError(
        "This letter contains too much formatting data.",
      );
    }

    let raw: unknown;
    try {
      raw = JSON.parse(input.json);
    } catch {
      throw new RichTextValidationError("This letter could not be read.");
    }

    let state = { imageIds: new Set<string>(), nodes: 0 };
    document = sanitizeNode(raw, 0, state, input.allowImages !== false);
    if (document.type !== "doc") {
      throw new RichTextValidationError("This letter could not be read.");
    }
  } else {
    document = documentFromPlainText(fallback);
  }

  let text = extractPlainText(document).trim();
  if (text.length === 0 && !input.allowEmpty) {
    throw new RichTextValidationError("This field cannot be empty.");
  }
  if (text.length > MAX_LETTER_CHARACTERS) {
    throw new RichTextValidationError("This is too long.");
  }

  let attachmentIds = collectAttachmentIds(document);
  if (attachmentIds.length > MAX_IMAGES_PER_LETTER) {
    throw new RichTextValidationError(
      `A letter can contain up to ${MAX_IMAGES_PER_LETTER} images.`,
    );
  }

  return {
    attachmentIds,
    document,
    json: JSON.stringify(document),
    text,
  };
}

export function safeRichTextDocument(
  json: string | null | undefined,
  fallback: string,
): RichTextNode {
  try {
    return normalizeRichText({ json, fallback }).document;
  } catch {
    return documentFromPlainText(fallback);
  }
}

export function attachmentIdFromSrc(src: string): string | null {
  return attachmentPathPattern.exec(src)?.[1]?.toLowerCase() ?? null;
}

export function RichText(handle: Handle<RichTextProps>) {
  return () => {
    let {
      className = "",
      fallback,
      fontKey = "handwritten",
      json,
    } = handle.props;
    let document = safeRichTextDocument(json, fallback);
    let classes = ["rich-prose", `font-${normalizeFontKey(fontKey)}`, className]
      .filter(Boolean)
      .join(" ");

    return <div className={classes}>{renderChildren(document.content)}</div>;
  };
}

function sanitizeNode(
  value: unknown,
  depth: number,
  state: { imageIds: Set<string>; nodes: number },
  allowImages: boolean,
): RichTextNode {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new RichTextValidationError(
      "This letter contains unsupported content.",
    );
  }
  if (depth > 12 || ++state.nodes > 1000) {
    throw new RichTextValidationError("This letter is too complex.");
  }

  switch (value.type) {
    case "doc":
      return {
        type: "doc",
        content: sanitizeChildren(value.content, depth, state, allowImages, [
          "paragraph",
          "blockquote",
          "bulletList",
          "image",
        ]),
      };
    case "paragraph":
      return {
        type: "paragraph",
        content: sanitizeChildren(value.content, depth, state, allowImages, [
          "text",
          "hardBreak",
        ]),
      };
    case "text": {
      if (typeof value.text !== "string") {
        throw new RichTextValidationError("This letter contains invalid text.");
      }
      return {
        type: "text",
        text: value.text.replaceAll("\u0000", ""),
        marks: sanitizeMarks(value.marks),
      };
    }
    case "hardBreak":
      return { type: "hardBreak" };
    case "blockquote":
      return {
        type: "blockquote",
        content: sanitizeChildren(value.content, depth, state, allowImages, [
          "paragraph",
        ]),
      };
    case "bulletList":
      return {
        type: "bulletList",
        content: sanitizeChildren(value.content, depth, state, allowImages, [
          "listItem",
        ]),
      };
    case "listItem":
      return {
        type: "listItem",
        content: sanitizeChildren(value.content, depth, state, allowImages, [
          "paragraph",
          "bulletList",
        ]),
      };
    case "image": {
      if (!allowImages || !isRecord(value.attrs)) {
        throw new RichTextValidationError("Images are not allowed here.");
      }
      let src = typeof value.attrs.src === "string" ? value.attrs.src : "";
      let attachmentId = attachmentIdFromSrc(src);
      if (!attachmentId) {
        throw new RichTextValidationError(
          "This letter contains an invalid image.",
        );
      }
      state.imageIds.add(attachmentId);
      if (state.imageIds.size > MAX_IMAGES_PER_LETTER) {
        throw new RichTextValidationError(
          `A letter can contain up to ${MAX_IMAGES_PER_LETTER} images.`,
        );
      }
      return {
        type: "image",
        attrs: {
          alt: readShortText(value.attrs.alt, 240),
          height: readDimension(value.attrs.height),
          src: `/uploads/${attachmentId}`,
          width: readDimension(value.attrs.width),
        },
      };
    }
    default:
      throw new RichTextValidationError(
        "This letter contains unsupported formatting.",
      );
  }
}

function sanitizeChildren(
  value: unknown,
  depth: number,
  state: { imageIds: Set<string>; nodes: number },
  allowImages: boolean,
  allowedTypes: RichTextNode["type"][],
): RichTextNode[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new RichTextValidationError("This letter contains invalid content.");
  }

  return value.map((child) => {
    if (
      !isRecord(child) ||
      !allowedTypes.includes(child.type as RichTextNode["type"])
    ) {
      throw new RichTextValidationError(
        "This letter contains unsupported formatting.",
      );
    }
    return sanitizeNode(child, depth + 1, state, allowImages);
  });
}

function sanitizeMarks(value: unknown): RichMark[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 3) {
    throw new RichTextValidationError(
      "This letter contains invalid formatting.",
    );
  }

  let marks: RichMark[] = [];
  for (let mark of value) {
    if (!isRecord(mark) || typeof mark.type !== "string") {
      throw new RichTextValidationError(
        "This letter contains invalid formatting.",
      );
    }
    if (mark.type === "bold" || mark.type === "italic") {
      if (!marks.some((existing) => existing.type === mark.type))
        marks.push({ type: mark.type });
      continue;
    }
    if (
      mark.type === "link" &&
      isRecord(mark.attrs) &&
      typeof mark.attrs.href === "string"
    ) {
      let href = safeLink(mark.attrs.href);
      if (!href)
        throw new RichTextValidationError(
          "This letter contains an invalid link.",
        );
      marks.push({ type: "link", attrs: { href } });
      continue;
    }
    throw new RichTextValidationError(
      "This letter contains unsupported formatting.",
    );
  }
  return marks.length > 0 ? marks : undefined;
}

function safeLink(value: string): string | null {
  let href = value.trim();
  if (href.length === 0 || href.length > 2048) return null;
  try {
    let url = new URL(href);
    return ["http:", "https:", "mailto:"].includes(url.protocol)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function readShortText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function readDimension(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= 2400
    ? value
    : undefined;
}

function documentFromPlainText(value: string): RichTextNode {
  let lines = value.replaceAll("\r\n", "\n").split("\n");
  return {
    type: "doc",
    content: lines.map((line) => ({
      type: "paragraph",
      content: line.length > 0 ? [{ type: "text", text: line }] : [],
    })),
  };
}

function collectAttachmentIds(document: RichTextNode): string[] {
  let ids = new Set<string>();
  walk(document, (node) => {
    if (node.type !== "image" || !node.attrs?.src) return;
    let id = attachmentIdFromSrc(node.attrs.src);
    if (id) ids.add(id);
  });
  return [...ids];
}

function extractPlainText(document: RichTextNode): string {
  function extract(node: RichTextNode): string {
    if (node.type === "text") return node.text ?? "";
    if (node.type === "hardBreak") return "\n";
    if (node.type === "image") return "";
    let content = (node.content ?? []).map(extract);
    if (
      node.type === "doc" ||
      node.type === "blockquote" ||
      node.type === "listItem"
    ) {
      return content.join("\n");
    }
    if (node.type === "bulletList")
      return content.map((line) => `• ${line}`).join("\n");
    return content.join("");
  }

  return extract(document).replace(/\n{3,}/g, "\n\n");
}

function walk(node: RichTextNode, visit: (node: RichTextNode) => void) {
  visit(node);
  for (let child of node.content ?? []) walk(child, visit);
}

function renderChildren(nodes: RichTextNode[] | undefined): RemixNode {
  return (nodes ?? []).map((node, index) => renderNode(node, index));
}

function renderNode(node: RichTextNode, key: number): RemixNode {
  switch (node.type) {
    case "paragraph":
      return (
        <p key={key}>
          {node.content?.length ? renderChildren(node.content) : <br />}
        </p>
      );
    case "text": {
      let content: RemixNode = node.text ?? "";
      for (let [index, mark] of (node.marks ?? []).entries()) {
        if (mark.type === "bold")
          content = <strong key={index}>{content}</strong>;
        if (mark.type === "italic") content = <em key={index}>{content}</em>;
        if (mark.type === "link") {
          content = (
            <a key={index} href={mark.attrs.href} rel="nofollow noreferrer">
              {content}
            </a>
          );
        }
      }
      return <span key={key}>{content}</span>;
    }
    case "hardBreak":
      return <br key={key} />;
    case "blockquote":
      return <blockquote key={key}>{renderChildren(node.content)}</blockquote>;
    case "bulletList":
      return <ul key={key}>{renderChildren(node.content)}</ul>;
    case "listItem":
      return <li key={key}>{renderChildren(node.content)}</li>;
    case "image":
      return (
        <figure key={key}>
          <img
            src={node.attrs?.src}
            alt={node.attrs?.alt ?? ""}
            width={node.attrs?.width}
            height={node.attrs?.height}
            loading="lazy"
          />
        </figure>
      );
    case "doc":
      return <div key={key}>{renderChildren(node.content)}</div>;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
