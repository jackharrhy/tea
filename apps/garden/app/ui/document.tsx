import { css, type RemixNode } from "remix/component";
import { legacyStyles } from "./legacy-styles.ts";

const documentStyles = css({
  backgroundColor: "var(--color-paper)",
  fontFamily: "var(--font-serif)",
  margin: 0,
  width: "100%",
  height: "100%",
  "& body": { margin: 0, width: "100%", height: "100%" },
  "& .now-playing": {
    minHeight: "8rem",
    opacity: 1,
    transition: "opacity 0.5s ease-out",
  },
});

export function mug(home: boolean) {
  return (
    <div class="flex justify-center">
      <canvas
        id="mug-canvas"
        class={home ? "my-16" : "my-0"}
        width={home ? 250 : 100}
        height={home ? 180 : 50}
        aria-label="Spinning tea mug"
      />
    </div>
  );
}

export function document(options: {
  title?: string;
  description?: string;
  ogImage?: string;
  width?: string;
  mainClass?: string;
  invert?: boolean;
  noFooter?: boolean;
  children: RemixNode;
  development: boolean;
  origin: string;
}) {
  const {
    title,
    description,
    ogImage,
    width,
    mainClass,
    invert,
    noFooter,
    children,
    development,
    origin,
  } = options;
  return (
    <html
      lang="en"
      class="bg-paper font-serif h-full"
      mix={[legacyStyles, documentStyles]}
    >
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <title>
          {title
            ? `${title.replaceAll("/", " / ")} · Jack Harrhy`
            : "Jack Harrhy"}
        </title>
        <link rel="stylesheet" href="/properties.css" />
        <link
          rel="stylesheet"
          href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/bold/style.css"
        />
        {["linkblog", "posts", "devblog"].map((source) => (
          <link
            rel="alternate"
            type="application/rss+xml"
            href={`${origin}/${source}/rss.xml`}
            title={`${source === "devblog" ? "Devblog" : source === "linkblog" ? "Linkblog" : "Posts"} - jackharrhy.dev`}
          />
        ))}
        <link
          rel="alternate"
          type="application/rss+xml"
          href="https://piclog.blue/user-feed.php?id=43"
          title="Crusty JPEG posts on piclog.blue"
        />
        <link
          rel="alternate"
          type="application/atom+xml"
          href="https://status.cafe/users/jack.atom"
          title="Updates on status.cafe"
        />
        {ogImage && <meta property="og:image" content={ogImage} />}
        {title && <meta property="og:title" content={title} />}
        {description && (
          <meta property="og:description" content={description} />
        )}
      </head>
      <body class="flex flex-col items-center h-full justify-between">
        <div
          class={`flex flex-col prose max-w-none prose-orange prose-md md:prose-lg lg:prose-xl prose-li:my-0 prose-p:mt-0 prose-p:mb-4 w-full min-h-full ${width || "max-w-[65ch]!"} ${invert ? "prose-invert" : ""}`}
        >
          <header
            class={`relative w-full not-prose px-8 py-10 pt-12 flex justify-between leading-none ${width ? "max-w-[65ch] mx-auto" : ""} ${invert ? "text-[#374151]" : ""}`}
          >
            {title && (
              <div class="absolute hidden sm:block left-36 lg:-left-20 top-8">
                {mug(false)}
              </div>
            )}
            <a href="/" class="hover:underline">
              Jack Harrhy
            </a>
            <div class="flex gap-4">
              <a href="/about" class="hover:underline">
                About
              </a>
              <a href="/projects" class="hover:underline">
                Projects
              </a>
              <a href="/now" class="hover:underline">
                Now
              </a>
            </div>
          </header>
          <main class={`pb-6 px-8 mx-auto w-full flex-1 ${mainClass || ""}`}>
            {children}
          </main>
          {!noFooter && (
            <footer class="flex items-center gap-4 justify-center text-sm text-base-500 w-full pb-8">
              <span>Made with 🫖</span>
            </footer>
          )}
        </div>
        <script
          type="module"
          src="/assets/app/ui/public/entry.js"
          data-development={development ? "true" : "false"}
        />
        {!development && (
          <script
            data-goatcounter="https://jackharrhy.goatcounter.com/count"
            src="https://gc.zgo.at/count.js"
            async
          />
        )}
      </body>
    </html>
  );
}
