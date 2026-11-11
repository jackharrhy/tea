import type { GardenConfig } from "../config.ts";
import { document } from "./document.tsx";

export function tool(
  kind: "youtube" | "tweet" | "lastfm",
  config: GardenConfig,
) {
  const title =
    kind === "youtube"
      ? "Youtube Thumbnail Fetcher"
      : kind === "tweet"
        ? "Tweet Archiver"
        : "Last.fm";
  const description =
    kind === "youtube"
      ? "Fetch the thumbnail of a Youtube video."
      : kind === "tweet"
        ? "Archive tweets from Twitter into a format that can be included on my site."
        : "A tool to display my current song on Last.fm.";
  return document({
    ...config,
    title,
    description,
    children: (
      <>
        <h1>{title}</h1>
        {kind === "lastfm" ? (
          <>
            <p>If I'm currently listening to something, you'll see it below:</p>
            <div class="now-playing my-7" data-now-playing="debug" />
          </>
        ) : (
          <>
            {kind === "tweet" && (
              <>
                <p>
                  I'd like to include tweets into my webpage, but ensure that
                  they're accessible here even if the tweet is nuked / Twitter
                  itself goes away.
                </p>
                <p>
                  Feel free to use this tool yourself, however I have made it
                  more as a thing for my own uses so it might not be very
                  ergonomic for others.
                </p>
                <h2 class="text-red-500">Work in progress, not done yet!</h2>
              </>
            )}
            <div class="not-prose my-10">
              <form
                method="post"
                action={
                  kind === "youtube"
                    ? "/tools/youtube-thumbnail-fetcher/fetch"
                    : "/tools/tweet-archiver/archive"
                }
                data-fragment="#result"
                class="flex flex-col items-center gap-6"
              >
                <input
                  type="text"
                  name="url"
                  aria-label={
                    kind === "youtube" ? "YouTube video URL" : "Tweet URL"
                  }
                  placeholder={
                    kind === "youtube"
                      ? "Enter a YouTube video URL"
                      : "Enter a tweet URL"
                  }
                  value={
                    kind === "youtube"
                      ? ""
                      : "https://x.com/jackharrhyisme/status/1873088463257661587"
                  }
                  class="w-full px-4 py-2 rounded border-2 border-shade-200 focus:border-orange-300 focus:outline-none placeholder:text-shade-400"
                />
                <button
                  type="submit"
                  class="w-32 bg-orange-300/20 hover:bg-orange-200/40 text-black py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {kind === "youtube" ? "Fetch" : "Archive"}
                </button>
              </form>
            </div>
            <div id="result" aria-live="polite" />
          </>
        )}
      </>
    ),
  });
}
