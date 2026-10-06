import type { Handle, RemixNode } from "remix/component";
import type { Collection, Entry, Field } from "./types.ts";
import { css } from "./styles.ts";

type Media = { id: string; filename: string };

function AdminDocument(
  handle: Handle<{
    siteName: string;
    title: string;
    children: RemixNode;
    loggedIn?: boolean;
  }>,
) {
  return () => (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="robots" content="noindex,nofollow" />
        <title>{handle.props.title} · teacms</title>
        <style>{css}</style>
      </head>
      <body>
        <header>
          <a href="/tea">
            🍵 teacms <span className="muted">/ {handle.props.siteName}</span>
          </a>
          {handle.props.loggedIn !== false && (
            <nav>
              <a href="/tea/media">Media</a>
              <form action="/tea/logout" method="post">
                <button className="secondary">Sign out</button>
              </form>
            </nav>
          )}
        </header>
        <main>{handle.props.children}</main>
      </body>
    </html>
  );
}

export function LoginPage(
  handle: Handle<{ siteName: string; error?: string }>,
) {
  return () => (
    <AdminDocument
      siteName={handle.props.siteName}
      title="Sign in"
      loggedIn={false}
    >
      <h1>Sign in</h1>
      {handle.props.error && (
        <p className="notice" role="alert">
          {handle.props.error}
        </p>
      )}
      <div className="card" style={{ maxWidth: "28rem" }}>
        <form action="/tea/login" method="post">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
          <div className="actions">
            <button>Sign in</button>
          </div>
        </form>
      </div>
    </AdminDocument>
  );
}

export function CollectionsPage(
  handle: Handle<{
    siteName: string;
    collections: readonly Collection[];
    links?: readonly { href: string; label: string }[];
  }>,
) {
  return () => (
    <AdminDocument siteName={handle.props.siteName} title="Collections">
      <h1>Collections</h1>
      <div className="grid">
        {handle.props.collections.map((collection) => (
          <div className="card">
            <h2>
              <a href={`/tea/${encodeURIComponent(collection.name)}`}>
                {collection.label}
              </a>
            </h2>
          </div>
        ))}
        {handle.props.links?.map((link) => (
          <div className="card">
            <h2>
              <a href={link.href}>{link.label}</a>
            </h2>
          </div>
        ))}
      </div>
    </AdminDocument>
  );
}

export function CollectionPage(
  handle: Handle<{
    siteName: string;
    collection: Collection;
    entries: Entry[];
  }>,
) {
  const collection = handle.props.collection;
  return () => (
    <AdminDocument siteName={handle.props.siteName} title={collection.label}>
      <p>
        <a href="/tea">← Collections</a>
      </p>
      <div className="row">
        <h1>{collection.label}</h1>
        <a
          className="button"
          href={`/tea/${encodeURIComponent(collection.name)}/new`}
        >
          New entry
        </a>
      </div>
      <table>
        <thead>
          <tr>
            <th>Slug</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {handle.props.entries.map((entry) => (
            <tr>
              <td>
                <a
                  href={`/tea/${encodeURIComponent(collection.name)}/${encodeURIComponent(entry.slug)}`}
                >
                  {entry.slug}
                </a>
              </td>
              <td>{entry.publishedAt ? "Published" : "Draft"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </AdminDocument>
  );
}

function FieldInput(
  handle: Handle<{
    field: Field;
    value?: string | number | boolean;
    media: Media[];
  }>,
) {
  const field = handle.props.field;
  const value = String(handle.props.value ?? "");
  return () => (
    <>
      <label htmlFor={field.name}>{field.label}</label>
      {field.type === "textarea" ? (
        <textarea
          id={field.name}
          name={field.name}
          required={field.required}
          defaultValue={value}
        />
      ) : field.type === "boolean" ? (
        <input
          id={field.name}
          name={field.name}
          type="checkbox"
          defaultChecked={Boolean(handle.props.value)}
          style={{ width: "auto" }}
        />
      ) : field.type === "select" || field.type === "media" ? (
        <select
          id={field.name}
          name={field.name}
          required={field.required}
          defaultValue={value}
        >
          <option value="">Choose…</option>
          {(field.type === "media"
            ? handle.props.media.map((item) => [item.id, item.filename])
            : (field.options ?? []).map((option) => [option, option])
          ).map(([key, label]) => (
            <option value={key}>{label}</option>
          ))}
          {field.type === "media" &&
            value &&
            !handle.props.media.some((item) => item.id === value) && (
              <option value={value}>Current image</option>
            )}
        </select>
      ) : field.type === "number" ? (
        <input
          id={field.name}
          name={field.name}
          type="number"
          step="any"
          required={field.required}
          defaultValue={value}
        />
      ) : field.type === "datetime" ? (
        <input
          id={field.name}
          name={field.name}
          type="datetime-local"
          required={field.required}
          defaultValue={value}
        />
      ) : field.type === "url" ? (
        <input
          id={field.name}
          name={field.name}
          type="url"
          required={field.required}
          defaultValue={value}
        />
      ) : (
        <input
          id={field.name}
          name={field.name}
          type="text"
          required={field.required}
          defaultValue={value}
        />
      )}
    </>
  );
}

export function EntryPage(
  handle: Handle<{
    siteName: string;
    collection: Collection;
    slug: string;
    entry: Entry | null;
    media: Media[];
    previewUrl?: string;
    history?: boolean;
  }>,
) {
  const { collection, slug, entry } = handle.props;
  const action = entry
    ? `/tea/${encodeURIComponent(collection.name)}/${encodeURIComponent(slug)}`
    : `/tea/${encodeURIComponent(collection.name)}/new`;
  return () => (
    <AdminDocument
      siteName={handle.props.siteName}
      title={entry ? slug : "New entry"}
    >
      <p>
        <a href={`/tea/${encodeURIComponent(collection.name)}`}>
          ← {collection.label}
        </a>
      </p>
      <h1>{entry ? slug : `New ${collection.label}`}</h1>
      <div className="card">
        <form action={action} method="post">
          <label htmlFor="slug">Slug</label>
          <input
            id="slug"
            name="slug"
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            maxLength={100}
            defaultValue={slug}
            readOnly={Boolean(entry)}
            required
          />
          {collection.fields.map((field) => (
            <FieldInput
              field={field}
              value={entry?.data[field.name]}
              media={handle.props.media}
            />
          ))}
          <input type="hidden" name="revision" value={entry?.revision ?? 0} />
          <div className="actions">
            <button>Save draft</button>
          </div>
        </form>
      </div>
      {entry && (
        <div className="card">
          <p>
            {entry.publishedAt
              ? `Published ${entry.publishedAt}`
              : "Not published yet"}
            . Publishing makes the saved draft visible to the site.
          </p>
          {handle.props.previewUrl && (
            <p>
              <a
                className="button"
                href={handle.props.previewUrl}
                target="_blank"
                rel="noreferrer"
              >
                Preview draft ↗
              </a>
            </p>
          )}
          <form action={`${action}/publish`} method="post">
            <input type="hidden" name="revision" value={entry.revision} />
            <button>Publish draft</button>
          </form>
          {entry.publishedAt && (
            <form action={`${action}/unpublish`} method="post">
              <input type="hidden" name="revision" value={entry.revision} />
              <button className="secondary">Unpublish</button>
            </form>
          )}
          {handle.props.history && (
            <p>
              <a href={`${action}/history`}>Revision history</a>
            </p>
          )}
        </div>
      )}
    </AdminDocument>
  );
}

export function HistoryPage(
  handle: Handle<{
    siteName: string;
    collection: Collection;
    slug: string;
    currentRevision: number;
    revisions: {
      revision: number;
      changed_at: string;
      published_at: string | null;
    }[];
  }>,
) {
  const path = `/tea/${encodeURIComponent(handle.props.collection.name)}/${encodeURIComponent(handle.props.slug)}`;
  return () => (
    <AdminDocument siteName={handle.props.siteName} title="Revision history">
      <p>
        <a href={path}>← {handle.props.slug}</a>
      </p>
      <h1>Revision history</h1>
      <p>
        Restoring a revision saves its content as a draft. Publish it when it is
        ready to go live.
      </p>
      <table>
        <thead>
          <tr>
            <th>Revision</th>
            <th>Saved</th>
            <th>Published</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {handle.props.revisions.map((revision) => (
            <tr>
              <td>{revision.revision}</td>
              <td>{revision.changed_at}</td>
              <td>{revision.published_at ? "Yes" : "No"}</td>
              <td>
                {revision.revision !== handle.props.currentRevision && (
                  <form
                    action={`${path}/history/${revision.revision}/restore`}
                    method="post"
                  >
                    <input
                      name="revision"
                      type="hidden"
                      value={handle.props.currentRevision}
                    />
                    <button className="secondary">Restore draft</button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </AdminDocument>
  );
}

export function MediaPage(
  handle: Handle<{ siteName: string; media: (Media & { alt: string })[] }>,
) {
  return () => (
    <AdminDocument siteName={handle.props.siteName} title="Media">
      <h1>Media</h1>
      <div className="card">
        <form method="post" action="/tea/media" encType="multipart/form-data">
          <label htmlFor="file">File</label>
          <input
            id="file"
            name="file"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/avif"
            required
          />
          <label htmlFor="alt">Alt text</label>
          <input id="alt" name="alt" required />
          <div className="actions">
            <button>Upload</button>
          </div>
        </form>
      </div>
      <div className="grid">
        {handle.props.media.map((item) => (
          <div className="card">
            <img
              src={`/api/media/${encodeURIComponent(item.id)}`}
              alt={item.alt}
              style={{
                maxWidth: "100%",
                height: "10rem",
                objectFit: "contain",
              }}
            />
            <p>{item.filename}</p>
            <code>{item.id}</code>
          </div>
        ))}
      </div>
    </AdminDocument>
  );
}
