import { css, type Handle, type RemixNode } from "remix/component";

import { routes } from "./routes.ts";

const page = css({
  minHeight: "100vh",
  margin: 0,
  padding: "48px 24px",
  color: "#111827",
  backgroundColor: "#f9fafb",
  fontFamily: "system-ui, sans-serif",
});
const content = css({ maxWidth: "512px", margin: "0 auto" });
const heading = css({ fontSize: "24px", fontWeight: 700, margin: "0 0 8px" });
const muted = css({ color: "#4b5563", lineHeight: 1.6 });
const link = css({ color: "#2563eb", textDecoration: "none" });
const panel = css({
  marginTop: "24px",
  padding: "24px",
  backgroundColor: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: "8px",
});
const field = css({ display: "block", marginTop: "16px", fontSize: "14px" });
const input = css({
  display: "block",
  boxSizing: "border-box",
  width: "100%",
  marginTop: "6px",
  padding: "8px 12px",
  border: "1px solid #d1d5db",
  borderRadius: "6px",
  font: "inherit",
});
const choice = css({
  display: "flex",
  alignItems: "flex-start",
  gap: "8px",
  marginTop: "12px",
});
const button = css({
  display: "block",
  width: "100%",
  marginTop: "24px",
  padding: "10px 16px",
  color: "white",
  backgroundColor: "#2563eb",
  border: 0,
  borderRadius: "6px",
  font: "inherit",
  fontWeight: 600,
  cursor: "pointer",
});

function Document(handle: Handle<{ children?: RemixNode; title?: string }>) {
  return () => (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{handle.props.title ?? "Lists"}</title>
      </head>
      <body mix={page}>
        <main mix={content}>{handle.props.children}</main>
      </body>
    </html>
  );
}

export type PublicList = {
  slug: string;
  name: string;
  description: string | null;
  fromDomain: string;
};

export function SubscribePage(
  handle: Handle<{ lists: PublicList[]; enabled: boolean; error?: string }>,
) {
  return () => {
    const { lists, enabled, error } = handle.props;
    const domains = new Map<string, PublicList[]>();
    for (const list of lists)
      domains.set(list.fromDomain, [
        ...(domains.get(list.fromDomain) ?? []),
        list,
      ]);

    return (
      <Document title="Subscribe | Lists">
        <h1 mix={heading}>Lists</h1>
        <p mix={muted}>
          Email lists affiliated with{" "}
          <a mix={link} href="https://jackharrhy.dev">
            Jack Harrhy
          </a>
          . Subscribe to hear about things being worked on, written about, or
          found interesting.
        </p>
        {!enabled ? (
          <p mix={muted}>Public subscriptions are temporarily unavailable.</p>
        ) : null}
        {enabled && error ? <p role="alert">{error}</p> : null}
        {enabled && lists.length === 0 ? (
          <p mix={muted}>No lists yet.</p>
        ) : null}
        {enabled && lists.length > 0 ? (
          <details mix={panel}>
            <summary mix={link}>Subscribe to a list</summary>
            <form method="post" action={routes.subscribe.submit.href()}>
              <label mix={field}>
                Email
                <input mix={input} type="email" name="email" required />
              </label>
              <label mix={field}>
                First name (optional)
                <input mix={input} name="firstName" />
              </label>
              <label mix={field}>
                Last name (optional)
                <input mix={input} name="lastName" />
              </label>
              {[...domains].map(([domain, domainLists]) => (
                <section>
                  {domains.size > 1 ? <h2>{domain}</h2> : null}
                  {domainLists.map((list) => (
                    <label mix={choice}>
                      <input type="checkbox" name="lists" value={list.slug} />
                      <span>
                        <strong>{list.name}</strong>
                        {list.description ? ` — ${list.description}` : ""}
                      </span>
                    </label>
                  ))}
                </section>
              ))}
              {domains.size > 1 ? (
                <p mix={muted}>
                  Lists on different domains send separate confirmation emails.
                </p>
              ) : null}
              <button mix={button} type="submit">
                Subscribe
              </button>
            </form>
          </details>
        ) : null}
      </Document>
    );
  };
}

export function ConfirmationSentPage(
  handle: Handle<{ email: string; domains: string[] }>,
) {
  return () => (
    <Document title="Check your email | Lists">
      <h1 mix={heading}>Check your email</h1>
      <div mix={panel}>
        <p mix={muted}>
          We sent{" "}
          {handle.props.domains.length > 1
            ? `${handle.props.domains.length} confirmation emails`
            : "a confirmation link"}{" "}
          to <strong>{handle.props.email}</strong>.{" "}
          {handle.props.domains.length > 1
            ? "You'll need to confirm each one separately."
            : "Click the link to confirm your subscription."}
        </p>
        {handle.props.domains.length > 1 ? (
          <ul>
            {handle.props.domains.map((domain) => (
              <li>From {domain}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </Document>
  );
}

export function StatusPage(
  handle: Handle<{
    title: string;
    message: string;
    link?: { href: string; label: string };
  }>,
) {
  return () => (
    <Document title={`${handle.props.title} | Lists`}>
      <h1 mix={heading}>{handle.props.title}</h1>
      <div mix={panel}>
        <p mix={muted}>{handle.props.message}</p>
        {handle.props.link ? (
          <a mix={link} href={handle.props.link.href}>
            {handle.props.link.label}
          </a>
        ) : null}
      </div>
    </Document>
  );
}

export type SubscriberPreferences = {
  subscriber: { email: string };
  lists: Array<{
    id: number;
    name: string;
    description: string | null;
    subscriptionStatus: string;
  }>;
};

export function PreferencesPage(
  handle: Handle<{ token: string; preferences: SubscriberPreferences }>,
) {
  return () => (
    <Document title="Preferences | Lists">
      <h1 mix={heading}>Preferences</h1>
      <p mix={muted}>
        Manage subscriptions for{" "}
        <strong>{handle.props.preferences.subscriber.email}</strong>
      </p>
      <form
        method="post"
        action={routes.preferences.update.href({ token: handle.props.token })}
      >
        <div mix={panel}>
          {handle.props.preferences.lists.map((list) => (
            <label mix={choice}>
              <input
                type="checkbox"
                name="listIds"
                value={String(list.id)}
                checked={list.subscriptionStatus === "confirmed"}
              />
              <span>
                {list.name}
                {list.description ? ` — ${list.description}` : ""}
              </span>
            </label>
          ))}
        </div>
        <button mix={button} type="submit">
          Save preferences
        </button>
      </form>
    </Document>
  );
}
