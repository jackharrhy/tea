# Karakeep link flow and Ref scope

Inspected the running `ghcr.io/karakeep-app/karakeep:0.33.2` container on `jack@newport` and the [matching v0.33.2 source](https://github.com/karakeep-app/karakeep/tree/v0.33.2). The inspection was read-only. No Karakeep entries were changed or imported.

## What Karakeep does when saving a URL

1. [`createBookmark`](https://github.com/karakeep-app/karakeep/blob/v0.33.2/packages/trpc/routers/bookmarks.ts) checks for an existing URL, stores a `bookmarks` row and a `bookmarkLinks` row, then queues a crawler job. A repeat save restores the existing entry and moves it to the top.
2. The [crawler worker](https://github.com/karakeep-app/karakeep/blob/v0.33.2/apps/workers/workers/crawlerWorker.ts) first performs a plain HTTP probe. It uses the content type to distinguish pages from direct images and PDFs.
3. The [probe](https://github.com/karakeep-app/karakeep/blob/v0.33.2/apps/workers/workers/crawler/probe.ts) reads a bounded portion of the HTML and stores title, description, image, and favicon early. A separate browser crawl can then capture rendered content, screenshots, and archives. Preview metadata can remain useful even when that browser crawl fails.
4. The [Twitter renderer](https://github.com/karakeep-app/karakeep/blob/v0.33.2/apps/web/components/dashboard/preview/content-renderers/XRenderer.tsx) recognizes post IDs in Twitter URLs and shows the post with `react-tweet`. The board/list card uses the saved metadata and image.

The current database has 39 bookmarks: 27 links and 12 uploaded assets. The links are 23 Twitter posts, 3 Instagram posts, and 1 YouTube link. All 27 link rows currently show `crawlStatus = failure`, but all 27 have a title, description, image URL, and favicon from the early probe. This explains why useful cards still appear in Karakeep despite the crawl status. The asset directory is about 7 MB. The inspection did not establish why the browser crawls failed.

## What Ref now provides

On a board, **Add link**, pasting a URL, or dropping a URL creates a movable link card. Ref fetches bounded preview metadata, stores it in the board's SQLite Durable Object, and caches a supported preview image in R2-compatible storage when available. A repeated URL selects the existing card. Selecting a card shows its details and, for Twitter, YouTube, or Instagram, an embedded post or video. The original URL remains one click away. Images and link cards sync across open tabs.

The 39 entries present during inspection were imported into the local board through Ref's link and image flows. Ref does not yet provide an automatic Karakeep import, full page archives or screenshots, readable article text, tags, search, or AI jobs.
