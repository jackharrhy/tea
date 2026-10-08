import type { Handle } from "remix/component";

import type { FontKey, Issue, IssueLetter, Letter } from "../../data/schema.ts";
import { routes } from "../../routes.ts";
import { RichText } from "../../ui/rich-text.tsx";
import { Document } from "../document.tsx";
import { RichLetterEditor } from "../write/public/rich-letter-editor.tsx";

export interface AdminIssue extends Issue {
  letters: Array<
    IssueLetter & {
      originalAuthor: string;
      originalBody: string;
      originalBodyJson: string | null;
      originalFontKey: FontKey;
    }
  >;
}

interface SteveInboxPageProps {
  issues?: AdminIssue[];
  letters: Letter[];
  setupRequired?: boolean;
  siteEnabled?: boolean;
}

export function SteveInboxPage(handle: Handle<SteveInboxPageProps>) {
  return () => {
    let {
      issues = [],
      letters,
      setupRequired = false,
      siteEnabled = true,
    } = handle.props;
    let inbox = letters.filter((letter) => letter.state === "inbox");
    let archived = letters.filter((letter) => letter.state === "archived");
    let drafts = issues.filter((issue) => issue.state === "draft");
    let published = issues.filter((issue) => issue.state === "published");

    return (
      <Document
        title="Steve's inbox | Letters to Steve"
        description="Steve's private inbox."
      >
        <div className="admin-shell">
          <header className="admin-header">
            <a href={routes.home.href()}>letters to steve</a>
            <h1>inbox ({inbox.length})</h1>
          </header>

          <main>
            {setupRequired ? (
              <section className="setup">
                <h2>setup required</h2>
                <p>
                  Set <code>STEVE_ADMIN_PASSWORD</code>, then sign in as{" "}
                  <code>steve</code>.
                </p>
              </section>
            ) : (
              <>
                <SiteAvailability enabled={siteEnabled} />

                <IssueSection issues={drafts} title="drafts" />

                <section
                  className="admin-section"
                  aria-labelledby="inbox-title"
                >
                  <h2 id="inbox-title">inbox</h2>

                  {inbox.length === 0 ? (
                    <p className="empty">no letters.</p>
                  ) : (
                    <div className="inbox-list">
                      {inbox.map((letter) => (
                        <InboxLetter letter={letter} key={letter.id} />
                      ))}
                    </div>
                  )}

                  {inbox.some((letter) => letter.can_publish) ? (
                    <NewIssueForm />
                  ) : null}
                </section>

                <IssueSection issues={published} title="published" />

                {archived.length > 0 ? (
                  <details className="archive">
                    <summary>archive ({archived.length})</summary>
                    <div className="inbox-list">
                      {archived.map((letter) => (
                        <ArchivedLetter letter={letter} key={letter.id} />
                      ))}
                    </div>
                  </details>
                ) : null}
              </>
            )}
          </main>
        </div>
      </Document>
    );
  };
}

function SiteAvailability(handle: Handle<{ enabled: boolean }>) {
  return () => {
    let { enabled } = handle.props;

    return (
      <section
        className="site-availability"
        id="site-availability"
        aria-labelledby="site-availability-title"
      >
        <div>
          <h2 id="site-availability-title">public site</h2>
          <p>{enabled ? "letters are open." : "only Steve is visible."}</p>
        </div>
        <form action={routes.steve.updateSite.href()} method="post">
          <button
            type="submit"
            className="site-switch"
            role="switch"
            aria-checked={enabled ? "true" : "false"}
            aria-label={`Turn the public site ${enabled ? "off" : "on"}`}
            name="enabled"
            value={enabled ? "off" : "on"}
          >
            <span className="site-switch-track" aria-hidden="true">
              <span />
            </span>
            <span>{enabled ? "on" : "off"}</span>
          </button>
        </form>
      </section>
    );
  };
}

function NewIssueForm() {
  return () => (
    <form
      action={routes.steve.createIssue.href()}
      className="new-issue"
      id="new-issue"
      method="post"
    >
      <label htmlFor="new-response">reply to the selected letters</label>
      <RichLetterEditor
        body=""
        bodyJson=""
        fieldName="response"
        fontKey="book"
        id="new-response"
        jsonFieldName="responseJson"
        label="Steve's reply"
      />
      <div className="button-row">
        <button
          type="submit"
          name="intent"
          value="draft"
          className="secondary-button"
        >
          save draft
        </button>
        <button type="submit" name="intent" value="publish">
          publish
        </button>
      </div>
    </form>
  );
}

function InboxLetter(handle: Handle<{ letter: Letter }>) {
  return () => {
    let { letter } = handle.props;
    let updateHref = routes.steve.updateLetter.href({
      letterId: String(letter.id),
    });

    return (
      <article className="inbox-letter" id={`letter-${letter.id}`}>
        <header>
          <div>
            <strong>{letter.author}</strong>
            <time dateTime={new Date(letter.created_at).toISOString()}>
              {formatDate(letter.created_at)}
            </time>
          </div>
          <span>{letter.can_publish ? "publishable" : "private"}</span>
        </header>

        <RichText
          className="inbox-body"
          fallback={letter.body}
          fontKey={letter.font_key}
          json={letter.body_json}
        />

        <div className="letter-controls">
          {letter.can_publish ? (
            <label className="select-letter">
              <input
                type="checkbox"
                form="new-issue"
                name="letterId"
                value={String(letter.id)}
              />
              include
            </label>
          ) : null}

          {letter.email ? (
            <>
              <a href={privateReplyHref(letter.email, letter.author)}>email</a>
              <form action={updateHref} method="post">
                <button
                  type="submit"
                  name="intent"
                  value="private-replied"
                  className="text-button"
                >
                  {letter.private_replied_at ? "replied" : "mark replied"}
                </button>
              </form>
            </>
          ) : null}

          <form action={updateHref} method="post">
            <button
              type="submit"
              name="intent"
              value="archive"
              className="text-button"
            >
              archive
            </button>
          </form>
        </div>
      </article>
    );
  };
}

function IssueSection(handle: Handle<{ issues: AdminIssue[]; title: string }>) {
  return () => {
    let { issues, title } = handle.props;
    if (issues.length === 0) return null;

    return (
      <section className="admin-section" aria-labelledby={`${title}-title`}>
        <h2 id={`${title}-title`}>{title}</h2>
        <div className="editorial-list">
          {issues.map((issue) => (
            <IssueEditor issue={issue} key={issue.id} />
          ))}
        </div>
      </section>
    );
  };
}

function IssueEditor(handle: Handle<{ issue: AdminIssue }>) {
  return () => {
    let { issue } = handle.props;
    let isPublished = issue.state === "published";

    return (
      <article className="issue-editor" id={`issue-${issue.id}`}>
        <header>
          <strong>letter {issue.id}</strong>
          {isPublished ? (
            <a href={routes.issue.href({ issueId: String(issue.id) })}>view</a>
          ) : (
            <span>draft</span>
          )}
        </header>

        <form
          action={routes.steve.updateIssue.href({ issueId: String(issue.id) })}
          method="post"
        >
          <div className="issue-editor-letters">
            {issue.letters.map((letter, index) => (
              <fieldset key={letter.id}>
                <legend>letter {index + 1}</legend>
                <input type="hidden" name="linkId" value={String(letter.id)} />
                <div className="field">
                  <label htmlFor={`author-${letter.id}`}>name</label>
                  <input
                    id={`author-${letter.id}`}
                    name={`author-${letter.id}`}
                    type="text"
                    maxLength={40}
                    required
                    defaultValue={letter.public_author}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`body-${letter.id}`}>letter</label>
                  <RichLetterEditor
                    body={letter.public_body}
                    bodyJson={letter.public_body_json ?? ""}
                    fieldName={`body-${letter.id}`}
                    fontFieldName={`fontKey-${letter.id}`}
                    fontKey={letter.font_key}
                    id={`body-${letter.id}`}
                    jsonFieldName={`bodyJson-${letter.id}`}
                    label={`Published letter ${index + 1}`}
                    required
                    showFontPicker
                  />
                </div>
                {letter.public_author !== letter.originalAuthor ||
                letter.public_body !== letter.originalBody ? (
                  <details className="original-letter">
                    <summary>original</summary>
                    <RichText
                      fallback={letter.originalBody}
                      fontKey={letter.originalFontKey}
                      json={letter.originalBodyJson}
                    />
                    <strong>{letter.originalAuthor}</strong>
                  </details>
                ) : null}
              </fieldset>
            ))}
          </div>

          <div className="field">
            <label htmlFor={`response-${issue.id}`}>Steve's reply</label>
            <RichLetterEditor
              body={issue.response}
              bodyJson={issue.response_json ?? ""}
              fieldName="response"
              fontKey="book"
              id={`response-${issue.id}`}
              jsonFieldName="responseJson"
              label="Steve's reply"
              required={isPublished}
            />
          </div>

          <div className="button-row">
            <button
              type="submit"
              name="intent"
              value="save"
              className="secondary-button"
            >
              save
            </button>
            {isPublished ? (
              <button
                type="submit"
                name="intent"
                value="unpublish"
                className="text-button"
              >
                unpublish
              </button>
            ) : (
              <>
                <button type="submit" name="intent" value="publish">
                  publish
                </button>
                <button
                  type="submit"
                  name="intent"
                  value="discard"
                  className="text-button danger-button"
                >
                  discard
                </button>
              </>
            )}
          </div>
        </form>
      </article>
    );
  };
}

function ArchivedLetter(handle: Handle<{ letter: Letter }>) {
  return () => {
    let { letter } = handle.props;

    return (
      <article className="inbox-letter compact-letter">
        <header>
          <strong>{letter.author}</strong>
          <time dateTime={new Date(letter.created_at).toISOString()}>
            {formatDate(letter.created_at)}
          </time>
        </header>
        <RichText
          className="inbox-body"
          fallback={letter.body}
          fontKey={letter.font_key}
          json={letter.body_json}
        />
        <form
          action={routes.steve.updateLetter.href({
            letterId: String(letter.id),
          })}
          method="post"
        >
          <button
            type="submit"
            name="intent"
            value="restore"
            className="text-button"
          >
            restore
          </button>
        </form>
      </article>
    );
  };
}

function privateReplyHref(email: string, author: string): string {
  let subject = encodeURIComponent("A reply from Steve");
  let body = encodeURIComponent(`Hi ${author},\n\n`);
  return `mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}`;
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(timestamp));
}
