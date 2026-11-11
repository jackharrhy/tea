# Optional diagnostics

Status: migration preparation. The current live standalone app is unchanged. The frontend and app-local backend patch must be accepted together in Harrhy before release.

The exact footer label is "send anonymous telemetry to help improve 8mb". It defaults off. A locally stored explicit preference may restore a previous opt-in. Unavailable local storage leaves consent scoped to the current page. Opting in does not replay earlier outcomes. Opting out aborts pending requests; there is no deferred queue or retry. Already received requests cannot be withdrawn by aborting a browser request.

While off, the diagnostics module does not read file context or the user agent and makes no requests. While on, it sends terminal processing outcomes. Ordinary progress percentages do not produce events. At most one request is in flight, with a three-second deadline and a six-request-per-minute page budget. Failed transport/storage never blocks editing. Requests use omitted credentials, no referrer, same-origin mode and no browser service worker or third-party collector.

## Data

The schema is flat and exact: schema version, browser family without a version, OS family, input-size bucket, duration bucket, resolution bucket, recognized container/video/audio codec, stage, outcome, normalized reason and elapsed-time bucket. The shared validator rejects arbitrary fields and values. Browser and codec strings are mapped to fixed enums; unknown values become `other`/`unknown`.

No media, thumbnails, filenames, paths, titles, raw error text/stacks, raw user agents, accounts, persistent device/session IDs or exact client timestamps are sent. Source information remains in the editor; only coarse allowlisted values leave it. Standard HTTP carries IP/UA headers, so the destination owner must verify ingress logging does not retain these requests as analytics. The app endpoint never persists those headers or logs its payload.

## Proposed Harrhy endpoint

The app-local patch uses Node 26, native Remix routing, `@harrhy/request-body` and Node SQLite. It accepts only `POST /8mb/api/diagnostics`, from the configured same origin, with JSON limited to 2 KiB of actual streamed bytes and a two-second read deadline. GET has no data-reading route. There are no cookies or public diagnostics queries.

Storage is daily aggregate counts grouped by sanitized metadata and a trusted server build revision. It contains no raw event rows. The limit is 10,000 groups across all dates and revisions, retained for seven UTC dates, with pruning at startup, during writes and hourly while running. A global 120-request-per-minute process budget needs no IP/session identity. Full storage returns 429; unavailable storage returns a generic 503 and can recover. The app host closes the store/timer on shutdown.

The Harrhy workspace tests the Remix router, streamed limits/timeouts, unknown/private fields, SQLite persistence/canonical aggregation, retention/caps and storage failure recovery. Frontend browser checks cover off-by-default behavior, opt-in payloads, opt-out persistence and continued export while offline. Production ingress and storage still require separate rollout acceptance.
