const origin = "https://andybaga.neocities.org";
const imageRoot = "https://andybaga.wordpress.com/wp-content/uploads/2025";
export const museumGif = await sharp(
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#402060"/><path d="M16 3L20 12L29 16L20 20L16 29L12 20L3 16L12 12Z" fill="#ffcc33"/></svg>',
  ),
)
  .gif()
  .toBuffer();

export function museumFixture(url) {
  if (url.origin === "https://andybaga.wordpress.com") {
    return new Response(museumGif, {
      headers: { "Content-Type": "image/gif" },
    });
  }
  if (url.origin !== origin) return null;
  const section = url.pathname.split("/")[2];
  if (url.pathname === `/museum/${section}`) {
    if (section === "bars")
      return new Response(`
      <img src="${imageRoot}/01/header.gif"><a name="animated"></a>
      <img src="${imageRoot}/01/elegantbarbl2.gif">
      <img src="${imageRoot}/01/bar.gif"><a href="#top"><img src="${imageRoot}/01/top.gif"></a>`);
    return new Response(`
      <a href="/museum/${section}/dragons.html"><b>Dragons &amp; Friends</b></a>
      <a href="/museum/${section}/dragons#top">Dragons &amp; Friends</a>
      <a href="/museum/${section}/adult">Adult</a>
      <a href="https://example.com/museum/${section}/other">Other</a>`);
  }
  if (url.pathname.endsWith("/dragons"))
    return new Response(`
    <table><tr><td><img src="${imageRoot}/01/header.gif"></td></tr></table>
    <table border="0" width="400"><tr><td><img src="${imageRoot}/01/related.gif"></td></tr></table>
    <table border="0" width="800"><tr><td>
      <img src="${imageRoot}/01/dragon.gif">
      <img src="${imageRoot}/01/dragon.gif">
      <img src="${imageRoot}/02/dragon.gif">
      <a href="#top"><img src="${imageRoot}/01/top.gif"></a>
      <img src="http://127.0.0.1/private.gif">
    </td></tr></table>`);
  return new Response("Fixture not found", { status: 404 });
}
import sharp from "sharp";
