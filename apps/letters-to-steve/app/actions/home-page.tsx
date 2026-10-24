import type { Handle } from "remix/component";

import type { FontKey } from "../data/schema.ts";
import { routes } from "../routes.ts";
import { RichText } from "../ui/rich-text.tsx";
import { CardComposer } from "./card-composer.tsx";
import { Document } from "./document.tsx";

interface PublicIssueLetter {
  author: string;
  body: string;
  bodyJson: string | null;
  fontKey: FontKey;
}

export interface PublicIssue {
  id: number;
  letters: PublicIssueLetter[];
  publishedAt: number;
  response: string;
  responseJson: string | null;
}

export interface LetterFormValues {
  author: string;
  body: string;
  bodyJson: string;
  canPublish: boolean;
  email: string;
  fontKey: FontKey;
}

export type FormErrors = Record<string, string | undefined>;

interface HomePageProps {
  issues: PublicIssue[];
}

interface WritePageProps {
  draftToken: string;
  errors?: FormErrors;
  sent?: boolean;
  values?: LetterFormValues;
}

const defaultValues: LetterFormValues = {
  author: "",
  body: "",
  bodyJson: "",
  canPublish: false,
  email: "",
  fontKey: "handwritten",
};

export function HomePage(handle: Handle<HomePageProps>) {
  return () => {
    let { issues } = handle.props;

    return (
      <Document>
        <div className="site-shell home-page">
          <SteveHeader />

          <main>
            <div className="write-prompt">
              <a className="button-link" href={routes.write.href()}>
                write to steve
              </a>
            </div>
            <IssueList issues={issues} />
          </main>

          <footer className="site-footer">
            <a className="footer-link" href={routes.steve.index.href()}>
              steve login
            </a>
          </footer>
        </div>
      </Document>
    );
  };
}

export function SiteClosedPage() {
  return () => (
    <Document browserRuntime={false}>
      <div className="site-closed-shell">
        <main className="site-closed-main">
          <img src="/steve.png" width="264" height="741" alt="Steve" />
        </main>
        <footer className="site-closed-footer">
          <a className="footer-link" href={routes.steve.index.href()}>
            steve login
          </a>
        </footer>
      </div>
    </Document>
  );
}

export function WritePage(handle: Handle<WritePageProps>) {
  return () => {
    let {
      draftToken,
      errors = {},
      sent = false,
      values = defaultValues,
    } = handle.props;

    return (
      <Document
        title="Write to Steve | Letters to Steve"
        head={
          <link
            rel="preload"
            href="/assets/npm/@fontsource-variable/shantell-sans/files/shantell-sans-latin-wght-normal.woff2"
            as="font"
            type="font/woff2"
            crossOrigin="anonymous"
          />
        }
      >
        <div className="write-shell">
          <header className="write-header">
            <a href={routes.home.href()}>letters to steve</a>
          </header>
          <main className="write-main">
            <CardComposer
              draftToken={draftToken}
              errors={errors}
              sent={sent}
              values={values}
            />
          </main>
        </div>
      </Document>
    );
  };
}

export function IssuePage(handle: Handle<{ issue: PublicIssue }>) {
  return () => {
    let { issue } = handle.props;

    return (
      <Document title={`Letter ${issue.id} | Letters to Steve`}>
        <div className="site-shell issue-page">
          <SteveHeader />
          <main>
            <p className="back-link">
              <a href={routes.home.href()}>all letters</a>
            </p>
            <IssueArticle issue={issue} />
          </main>
        </div>
      </Document>
    );
  };
}

function SteveHeader() {
  return () => (
    <header className="steve-header">
      <h1>
        <a href={routes.home.href()}>letters to steve</a>
      </h1>
      <img src="/steve.png" width="264" height="741" alt="Steve" />
    </header>
  );
}

function IssueList(handle: Handle<{ issues: PublicIssue[] }>) {
  return () => {
    let { issues } = handle.props;

    return (
      <section className="letters" aria-labelledby="letters-title">
        <h2 id="letters-title">letters from steve</h2>

        {issues.length === 0 ? (
          <p className="empty">none yet.</p>
        ) : (
          <div className="issue-list">
            {issues.map((issue) => (
              <IssueArticle issue={issue} key={issue.id} />
            ))}
          </div>
        )}
      </section>
    );
  };
}

function IssueArticle(handle: Handle<{ issue: PublicIssue }>) {
  return () => {
    let { issue } = handle.props;
    let href = routes.issue.href({ issueId: String(issue.id) });

    return (
      <article className="issue" id={`issue-${issue.id}`}>
        <header className="issue-meta">
          <a href={href}>letter {issue.id}</a>
          <time dateTime={new Date(issue.publishedAt).toISOString()}>
            {formatDate(issue.publishedAt)}
          </time>
        </header>

        <div className="issue-questions">
          {issue.letters.map((letter, index) => (
            <blockquote className="issue-question" key={index}>
              <RichText
                fallback={letter.body}
                fontKey={letter.fontKey}
                json={letter.bodyJson}
              />
              <footer>{letter.author}</footer>
            </blockquote>
          ))}
        </div>

        <div className="issue-response">
          <RichText
            className="steve-prose"
            fallback={issue.response}
            fontKey="book"
            json={issue.responseJson}
          />
          <strong>Steve</strong>
        </div>
      </article>
    );
  };
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(timestamp));
}
