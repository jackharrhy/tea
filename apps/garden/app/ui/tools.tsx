import type { GardenConfig } from "../config.ts";
import { document } from "./document.tsx";
import { NowPlaying } from "./public/now-playing.tsx";
import { ToolForm } from "./public/tool-form.tsx";

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
            <NowPlaying debug />
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
            <ToolForm
              kind={kind}
              action={
                kind === "youtube"
                  ? "/tools/youtube-thumbnail-fetcher/fetch"
                  : "/tools/tweet-archiver/archive"
              }
            />
          </>
        )}
      </>
    ),
  });
}
