import { createFeeds, projectNameToBetterName } from "./feeds.ts";
import { resolveOgImage } from "./utils.ts";
import type { GardenEntry } from "./store.ts";

function xml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export async function feed(
  source: string,
  entries: GardenEntry[],
  origin: string,
  now = new Date(),
) {
  const feeds = createFeeds(entries);
  const posts = source === "posts" ? [] : await feeds.getPosts(source);
  // Preserve the existing feed's date cutoff in Newfoundland time.
  const today = new Date(
    now.toLocaleString("en-US", { timeZone: "America/St_Johns" }),
  );
  today.setHours(8, 0, 0, 0);
  const items = posts
    .filter((post) => new Date(post.id.split("/").slice(-3).join("-")) < today)
    .slice(0, 10);
  const name =
    source === "devblog"
      ? "Devblog"
      : source === "linkblog"
        ? "Linkblog"
        : "Posts";
  return `<?xml version="1.0" encoding="UTF-8"?><?xml-stylesheet href="/rss/styles/general.xsl" type="text/xsl"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>${name} - jackharrhy.dev</title><description>${name} from Jack Harrhy</description><link>${xml(origin)}</link><language>en-us</language>${items
    .map((post) => {
      const date = new Date(post.id.split("/").slice(-3).join("-"));
      const project = post.id.split(
        "/",
      )[1] as keyof typeof projectNameToBetterName;
      const title =
        source === "linkblog"
          ? `${post.id.replace("linkblog/", "")} - ${post.data.description}`
          : `${projectNameToBetterName[project]} - ${post.data.description}`;
      const image = resolveOgImage(post.data["og-image"]);
      return `<item><title>${xml(title)}</title><link>${xml(`${origin}/${post.id}`)}</link><guid isPermaLink="true">${xml(`${origin}/${post.id}`)}</guid><pubDate>${date.toUTCString()}</pubDate>${image ? `<media:content type="image/${image.endsWith(".jpg") || image.endsWith(".jpeg") ? "jpeg" : image.endsWith(".webp") ? "webp" : "png"}" medium="image" url="${xml(new URL(image, origin).href)}"/>` : ""}</item>`;
    })
    .join("")}</channel></rss>`;
}
