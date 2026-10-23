import type { LinkPreview } from "./protocol.ts";
import { tokenHash } from "./crypto.ts";

const MAX_URL_LENGTH = 2048;
const MAX_HTML_BYTES = 256 * 1024;
const MAX_REDIRECTS = 3;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export function normalizeLinkUrl(value: string): string | null {
  const input = value.trim();
  if (!input || input.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !host.includes(".") ||
    host.startsWith("[") ||
    /^\d+(?:\.\d+){3}$/.test(host) ||
    /(?:^|\.)(?:localhost|local|internal|lan|test|invalid|onion)$/.test(host)
  )
    return null;
  url.hash = "";
  return url.href;
}

export async function previewLink(url: string): Promise<LinkPreview> {
  const host = new URL(url).hostname.replace(/^www\./, "");
  const fallback: LinkPreview = {
    url,
    title: host,
    description: "",
    imageUrl: null,
    siteName: host,
  };
  const youtube = await youtubePreview(url);
  if (youtube) return youtube;
  for (const candidate of previewCandidates(url)) {
    try {
      const fetched = await fetchPublic(
        candidate,
        AbortSignal.timeout(12_000),
        {
          Accept: "text/html,image/*;q=0.8",
          "User-Agent": "Ref/1.0 (+link-preview)",
        },
      );
      if (!fetched) continue;
      const { response, url: finalUrl } = fetched;
      if (!response.ok) {
        await response.body?.cancel();
        continue;
      }
      const type = response.headers
        .get("Content-Type")
        ?.split(";", 1)[0]
        ?.toLowerCase();
      if (type?.startsWith("image/")) {
        await response.body?.cancel();
        return { ...fallback, imageUrl: finalUrl };
      }
      if (type !== "text/html" && type !== "application/xhtml+xml") {
        await response.body?.cancel();
        continue;
      }
      const html = await readPrefix(response.body, MAX_HTML_BYTES);
      const preview = {
        ...fallback,
        ...(await extractMetadata(html, finalUrl)),
        url,
      };
      if (!isGenericSocialPreview(preview)) return preview;
    } catch {
      // A blocked preview should not prevent saving the link.
    }
  }
  return fallback;
}

function previewCandidates(url: string): string[] {
  const parsed = new URL(url);
  const host = parsed.hostname.replace(/^www\./, "");
  if (host === "instagram.com") {
    const reel = /^\/reel\/([A-Za-z0-9_-]+)\/?$/.exec(parsed.pathname);
    if (reel) return [url, `https://www.instagram.com/p/${reel[1]}/`];
  }
  if (host === "x.com" || host === "twitter.com") {
    const post = /^\/([^/]+)\/status\/(\d+)/.exec(parsed.pathname);
    if (post) {
      const canonical = `https://x.com/${post[1]}/status/${post[2]}`;
      if (canonical !== url) return [url, canonical];
    }
  }
  return [url];
}

export function isGenericSocialPreview(preview: LinkPreview): boolean {
  const host = new URL(preview.url).hostname.replace(/^www\./, "");
  const title = preview.title.trim().toLowerCase();
  if (host === "instagram.com")
    return title === "instagram" || title === "login • instagram";
  if (host === "x.com" || host === "twitter.com")
    return title === "x on x" || title === "x" || title === "twitter";
  return false;
}

async function youtubePreview(url: string): Promise<LinkPreview | null> {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  const isYoutube = [
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
  ].includes(host);
  const isShortLink = host === "youtu.be" || host === "www.youtu.be";
  if (!isYoutube && !isShortLink) return null;
  const videoId = isShortLink
    ? parsed.pathname.slice(1).split("/")[0]
    : parsed.pathname === "/watch"
      ? parsed.searchParams.get("v")
      : parsed.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)/)?.[1];
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;

  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      {
        signal: AbortSignal.timeout(8_000),
        headers: { Accept: "application/json" },
      },
    );
    if (
      !response.ok ||
      !response.headers.get("Content-Type")?.includes("application/json")
    ) {
      await response.body?.cancel();
      return null;
    }
    const bytes = await readPrefix(response.body, 32 * 1024 + 1);
    if (bytes.length > 32 * 1024) return null;
    const data: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!data || typeof data !== "object") return null;
    const result = data as Record<string, unknown>;
    if (typeof result.title !== "string") return null;
    const title = clean(result.title, 200);
    if (!title) return null;
    const imageUrl =
      typeof result.thumbnail_url === "string"
        ? normalizeLinkUrl(result.thumbnail_url)
        : null;
    return { url, title, description: "", imageUrl, siteName: "YouTube" };
  } catch {
    return null;
  }
}

export async function cachePreviewImage(
  preview: LinkPreview,
  media: R2Bucket,
  boardId: string,
): Promise<LinkPreview> {
  if (!preview.imageUrl) return preview;
  const hash = await tokenHash(preview.imageUrl);
  const key = `boards/${boardId}/previews/${hash}`;
  const signal = AbortSignal.timeout(10_000);
  try {
    const existing = await media.head(key);
    if (existing)
      return { ...preview, imageUrl: `/previews/${boardId}/${hash}` };
    const fetched = await fetchPublic(preview.imageUrl, signal, {
      Accept: "image/*",
    });
    if (!fetched) return preview;
    const { response } = fetched;
    const type = response.headers
      .get("Content-Type")
      ?.split(";", 1)[0]
      ?.toLowerCase();
    if (!response.ok || !type || !IMAGE_TYPES.has(type)) {
      await response.body?.cancel();
      return preview;
    }
    const bytes = await readPrefix(response.body, MAX_IMAGE_BYTES + 1);
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return preview;
    await media.put(key, bytes.buffer as ArrayBuffer, {
      httpMetadata: { contentType: type },
    });
    return { ...preview, imageUrl: `/previews/${boardId}/${hash}` };
  } catch {
    // Keep the original image URL when caching fails.
  }
  return preview;
}

async function fetchPublic(
  url: string,
  signal: AbortSignal,
  headers: HeadersInit,
): Promise<{ response: Response; url: string } | null> {
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const response = await fetch(url, { redirect: "manual", signal, headers });
    if (response.status < 300 || response.status >= 400)
      return { response, url };
    await response.body?.cancel();
    const location = response.headers.get("Location");
    const next = location
      ? normalizeLinkUrl(new URL(location, url).href)
      : null;
    if (!next) return null;
    url = next;
  }
  return null;
}

async function readPrefix(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (length < limit) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = value.slice(0, limit - length);
      chunks.push(chunk);
      length += chunk.length;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

async function extractMetadata(
  html: Uint8Array,
  base: string,
): Promise<Partial<LinkPreview>> {
  const fields = new Map<string, string>();
  let documentTitle = "";
  const source = new Response(html.buffer as ArrayBuffer, {
    headers: { "Content-Type": "text/html" },
  });
  const parsed = new HTMLRewriter()
    .on("meta", {
      element(element) {
        const key = (
          element.getAttribute("property") ??
          element.getAttribute("name") ??
          ""
        ).toLowerCase();
        const value = element.getAttribute("content");
        if (key && value && !fields.has(key)) fields.set(key, value);
      },
    })
    .on("title", {
      text(chunk) {
        documentTitle += chunk.text;
      },
    })
    .transform(source);
  await parsed.arrayBuffer();
  const pick = (...keys: string[]) =>
    keys.map((key) => fields.get(key)).find(Boolean) ?? "";
  const title = clean(pick("og:title", "twitter:title") || documentTitle, 200);
  const description = clean(
    pick("og:description", "twitter:description", "description"),
    700,
  );
  const siteName = clean(pick("og:site_name"), 100);
  const imageValue = pick("og:image:secure_url", "og:image", "twitter:image");
  let imageUrl: string | null = null;
  if (imageValue) {
    try {
      imageUrl = normalizeLinkUrl(
        new URL(decodeEntities(imageValue), base).href,
      );
    } catch {}
  }
  return {
    ...(title ? { title } : {}),
    description,
    imageUrl,
    ...(siteName ? { siteName } : {}),
  };
}

function clean(value: string, limit: number): string {
  return decodeEntities(value)
    .replace(/[\p{Cc}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function decodeEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi,
    (match, entity: string) => {
      const named: Record<string, string> = {
        amp: "&",
        quot: '"',
        apos: "'",
        lt: "<",
        gt: ">",
        nbsp: " ",
      };
      if (entity[0] === "#") {
        const number =
          entity[1]?.toLowerCase() === "x"
            ? Number.parseInt(entity.slice(2), 16)
            : Number.parseInt(entity.slice(1), 10);
        return Number.isFinite(number) && number > 0 && number <= 0x10ffff
          ? String.fromCodePoint(number)
          : match;
      }
      return named[entity.toLowerCase()] ?? match;
    },
  );
}
