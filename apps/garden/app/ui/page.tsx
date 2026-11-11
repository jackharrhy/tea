import { type RemixNode, css } from "remix/component";
import { Fragment, jsx, jsxs } from "remix/component/jsx-runtime";
import { fromHtml } from "hast-util-from-html";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import type { GardenEntry } from "../content/store.ts";
import type { RenderedSegment } from "../content/markdown.ts";
import { createFeeds, deslugify } from "../content/feeds.ts";
import {
  getBreadcrumbs,
  getDisplayName,
  getPageLayoutConfig,
  getRenderedTitle,
  shouldIncludeTitleInBreadcrumbs,
} from "../content/page.ts";
import { resolveOgImage } from "../content/utils.ts";
import { document, mug } from "./document.tsx";
import type { GardenConfig } from "../config.ts";
import { NowPlaying } from "./public/now-playing.tsx";

async function component(
  props: Record<string, string>,
  entries: GardenEntry[],
  home: boolean,
  origin: string,
): Promise<RemixNode> {
  const feeds = createFeeds(entries);
  switch (props.component) {
    case "Mug":
      return mug(home);
    case "NowPlaying":
      return <NowPlaying />;
    case "Letterbird":
      return (
        <div class="not-prose my-8">
          <iframe
            src="https://letterbird.co/jackharrhy"
            mix={css({ width: "100%", height: "400px", border: 0 })}
            title="Contact form"
          />
        </div>
      );
    case "Project":
      return (
        <a
          href={props.link}
          target="_blank"
          rel="noopener"
          class={`not-prose hover:underline w-[12rem] ${props.variant === "block" ? "flex" : "inline-flex"} flex-col text-black p-1 ${props.variant === "small" ? "text-[0.8rem]" : "text-[1.1rem]"}`}
        >
          {props.image && (
            <img
              src={props.image}
              alt=""
              class="aspect-[12/9] w-full object-cover border mb-3 mt-4"
            />
          )}
          <p class="font-semibold m-0 text-[1.1em]">{props.name}</p>
          <p class="m-0 text-[0.9em]">{props.description}</p>
          <p class="m-0 text-[0.9em] italic text-shade-800">{props.date}</p>
        </a>
      );
    case "Feed":
      return (
        <ul>
          {(await feeds.getPosts(props.source))
            .slice(0, Number(props.limit) || undefined)
            .map((item) => (
              <li>
                <p>
                  <a href={`/${item.id}`}>{deslugify(item.id)}</a>
                  {item.data.description && <> {item.data.description}</>}
                </p>
              </li>
            ))}
        </ul>
      );
    case "FeedTree": {
      const tree = await feeds.getPostsAsTree(props.source);
      return (
        <>
          <a
            class="no-underline"
            href={`${origin}/${props.source}/rss.xml`}
            aria-label="RSS feed"
          >
            <i class="ph-bold ph-rss" />
          </a>
          <div class="not-prose">
            {Object.entries(tree).map(([year, months]) => (
              <details open>
                <summary class="border-t-2 border-dashed border-shade-300">
                  {year}
                </summary>
                <div class="ml-8 border-t-2 border-dashed border-shade-300">
                  {Object.entries(months).map(([month, days]) => (
                    <details
                      open
                      class="border-b-2 border-dashed border-shade-300"
                    >
                      <summary>{month}</summary>
                      <ul class="ml-8">
                        {Object.entries(days)
                          .toSorted((a, b) => b[0].localeCompare(a[0]))
                          .map(([day, post]) => (
                            <li class="last:border-b-0 border-b-2 border-dashed border-shade-300">
                              <a
                                href={`/${post.id}`}
                                class="flex gap-3 items-center justify-between hover:underline"
                              >
                                <span class="underline text-[var(--tw-prose-links)]">
                                  {day}
                                </span>
                                <span class="text-[.9rem] pb-[0.1rem] text-balance text-right">
                                  {post.data.description}
                                </span>
                              </a>
                            </li>
                          ))}
                      </ul>
                    </details>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </>
      );
    }
    default:
      throw new Error(`Unknown component: ${props.component}`);
  }
}

export async function page(
  entry: GardenEntry,
  entries: GardenEntry[],
  segments: RenderedSegment[],
  config: GardenConfig,
) {
  const displayName = getDisplayName(entry);
  const layout = getPageLayoutConfig(
    entry.data.custom_layout || entry.data["custom-layout"],
    entry.id !== "home",
  );
  const breadcrumbs = getBreadcrumbs(
    entry,
    displayName,
    new Set(entries.map((item) => item.id)),
  );
  const title = getRenderedTitle(entry, displayName);
  const contents = await Promise.all(
    segments.map(async (segment) =>
      segment.type === "prose"
        ? (toJsxRuntime(fromHtml(segment.html, { fragment: true }), {
            Fragment,
            jsx,
            jsxs,
            elementAttributeNameCase: "html",
          }) as unknown as RemixNode)
        : component(segment.props, entries, entry.id === "home", config.origin),
    ),
  );
  return document({
    ...layout,
    ...config,
    title: displayName === "Home" ? undefined : displayName,
    description: entry.data.description,
    ogImage: resolveOgImage(entry.data["og-image"]),
    children: (
      <>
        {!layout.noHeader && (
          <>
            {breadcrumbs.length > 0 && (
              <div class="not-prose text-xl mb-2 font-medium">
                {breadcrumbs.map((crumb, index) => (
                  <>
                    {crumb.path ? (
                      <a href={crumb.path} class="hover:underline">
                        {crumb.name}
                      </a>
                    ) : (
                      <span>{crumb.name}</span>
                    )}
                    {index < breadcrumbs.length - 1 && (
                      <span class="mx-2">/</span>
                    )}
                  </>
                ))}
              </div>
            )}
            <h1
              class={`${layout.centerHeader ? "text-center" : ""} ${breadcrumbs.length ? "pt-4" : ""} ${title.length > 120 ? "!text-3xl" : ""}`}
            >
              {title}
            </h1>
          </>
        )}
        {entry.data.description &&
          !shouldIncludeTitleInBreadcrumbs(entry.id) && (
            <p class="not-prose text-2xl font-medium mb-10">
              {entry.data.description}
            </p>
          )}
        {contents}
      </>
    ),
  });
}
