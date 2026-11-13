import { css, type Handle } from "remix/component";
import { renderToString } from "remix/component/server";
import { uiPrimaryActionStyles } from "@harrhy/ui";
import { directorySections } from "./directory.mjs";
import { Document, type DocumentProps } from "./document.tsx";

type DirectoryItem = {
  id: string;
  name: string;
  status: string;
  description: string;
  url?: string;
  setupRequired?: boolean;
  grant?: { roleKeys: string[] };
  sources: { source: string; role: string }[];
  nativeCleanup?: string;
  directorySection?: string;
};

type DirectoryContext = Omit<DocumentProps, "title" | "children">;

const appGridStyles = css({
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: "16px",
});

const appEntryStyles = css({
  display: "grid",
  gridTemplateColumns: "36px minmax(0, 1fr)",
  gap: "17px",
  padding: "24px",
  background: "#fff",
  border: "1px solid var(--line)",
  borderRadius: "8px",
  alignItems: "start",
});

function AppEntry(
  handle: Handle<{ item: DirectoryItem; context: DirectoryContext }>,
) {
  return () => {
    const { item, context } = handle.props;
    return (
      <article class="app-entry" mix={appEntryStyles}>
        <div class="app-monogram" aria-hidden="true">
          {item.name.slice(0, 1)}
        </div>
        <div>
          <h2>
            {item.url && !item.setupRequired && !context.preview ? (
              <a class="app-launch" href={item.url}>
                {item.name}
              </a>
            ) : (
              item.name
            )}
          </h2>
          {item.status === "Open" ? null : (
            <p class="app-status">{item.status}</p>
          )}
        </div>
        <a
          class="access-link"
          href={`${context.preview?.base || ""}/apps/${item.id}`}
        >
          Access details<span class="sr-only"> for {item.name}</span>
        </a>
      </article>
    );
  };
}

function DirectoryPage(
  handle: Handle<{ items: DirectoryItem[]; context: DirectoryContext }>,
) {
  return () => {
    const { items, context } = handle.props;
    const usable = items.filter((item) => item.status !== "Join");
    const joinable = items.filter((item) => item.status === "Join");
    return (
      <Document {...context} title="Your apps" active="apps">
        <div class="page-heading">
          <div>
            <h1>Your apps</h1>
          </div>
        </div>
        {usable.length ? (
          directorySections(usable).map((section) => (
            <section class="app-section">
              {section.title ? (
                <h2 class="app-section-title">{section.title}</h2>
              ) : null}
              <div class="app-grid" mix={appGridStyles}>
                {section.items.map((item: DirectoryItem) => (
                  <AppEntry item={item} context={context} />
                ))}
              </div>
            </section>
          ))
        ) : (
          <p class="empty">No apps are assigned yet.</p>
        )}
        {joinable.length ? (
          <section class="section">
            <h2>You can join</h2>
            <div class="app-grid" mix={appGridStyles}>
              {joinable.map((item) => (
                <AppEntry item={item} context={context} />
              ))}
            </div>
          </section>
        ) : null}
      </Document>
    );
  };
}

function AppDetailPage(
  handle: Handle<{ item: DirectoryItem; context: DirectoryContext }>,
) {
  return () => {
    const { item, context } = handle.props;
    const source = item.sources.length
      ? item.sources.map((entry) => `${entry.source} → ${entry.role}`)
      : [
          item.status === "Public"
            ? "Public destination"
            : item.status === "Join"
              ? "Explicit enrollment required"
              : "Native project eligibility",
        ];
    return (
      <Document {...context} title={item.name} active="apps">
        <div class="page-heading">
          <div>
            <h1>{item.name}</h1>
            <p class="muted">{item.description}</p>
          </div>
        </div>
        <section class="detail-section">
          <h2>Your access</h2>
          <dl class="profile">
            <div>
              <dt>Availability</dt>
              <dd>{item.status}</dd>
            </div>
            {item.grant ? (
              <div>
                <dt>Service roles</dt>
                <dd>{item.grant.roleKeys.join(", ")}</dd>
              </div>
            ) : null}
            <div>
              <dt>Source</dt>
              <dd>
                {source.map((line, index) => (
                  <>
                    {index ? <br /> : null}
                    {line}
                  </>
                ))}
              </dd>
            </div>
          </dl>
          {context.preview ? null : item.setupRequired ? (
            <p class="notice">
              Ask your Auth administrator to review the native account link.
              Central eligibility alone does not complete setup.
            </p>
          ) : item.url ? (
            <a
              class="button primary"
              mix={uiPrimaryActionStyles}
              href={item.url}
            >
              {item.status === "Join" ? "Join " : "Open "}
              {item.name}
            </a>
          ) : (
            <p class="muted">Open this service from its desktop client.</p>
          )}
        </section>
        <section class="detail-section">
          <h2>Inside the app</h2>
          <p>{item.description}</p>
          <p class="muted">
            {item.nativeCleanup ||
              "App accounts, content ownership and sessions are managed by the destination."}
          </p>
        </section>
        <a class="text-link" href={context.preview?.base || "/"}>
          Your apps
        </a>
      </Document>
    );
  };
}

export function renderDirectory(
  items: DirectoryItem[],
  context: DirectoryContext,
  nonce: string,
) {
  return renderToString(<DirectoryPage items={items} context={context} />, {
    nonce,
  });
}

export function renderAppDetail(
  item: DirectoryItem,
  context: DirectoryContext,
  nonce: string,
) {
  return renderToString(<AppDetailPage item={item} context={context} />, {
    nonce,
  });
}
