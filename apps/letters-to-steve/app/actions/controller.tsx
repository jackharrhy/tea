import { randomUUID } from "node:crypto";

import * as s from "remix/data-schema";
import * as f from "remix/data-schema/form-data";
import { maxLength, minLength } from "remix/data-schema/checks";
import type { SqliteDatabase } from "remix/data-table/sqlite";
import { inList } from "remix/data-table/operators";
import { createController } from "remix/router";
import { redirect } from "remix/response/redirect";

import { assets } from "../assets.ts";
import {
  attachments,
  fontKeys,
  issueLetters,
  issues,
  letters,
  type Issue,
} from "../data/schema.ts";
import { isSiteEnabled } from "../data/site-settings.ts";
import { attachmentStoreContext } from "../middleware/attachments.ts";
import { databaseContext } from "../middleware/database.ts";
import { routes } from "../routes.ts";
import {
  MAX_RICH_TEXT_BYTES,
  normalizeFontKey,
  normalizeRichText,
  RichTextValidationError,
} from "../ui/rich-text.tsx";
import {
  HomePage,
  IssuePage,
  SiteClosedPage,
  WritePage,
  type FormErrors,
  type LetterFormValues,
  type PublicIssue,
} from "./home-page.tsx";

const trimmedString = s.string().transform((value) => value.trim());

const letterFormSchema = f.object({
  author: f.field(trimmedString.pipe(minLength(1), maxLength(40))),
  email: f.field(
    trimmedString.refine(
      (value) => value === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
      "Enter a valid email address or leave this blank.",
    ),
  ),
  body: f.field(s.string().pipe(maxLength(5000))),
  bodyJson: f.field(
    s.defaulted(s.string().pipe(maxLength(MAX_RICH_TEXT_BYTES)), ""),
  ),
  draftToken: f.field(
    s
      .string()
      .refine(
        (value) => isUuid(value),
        "Reload the writing page and try again.",
      ),
  ),
  fontKey: f.field(s.defaulted(s.enum_(fontKeys), "handwritten")),
  canPublish: f.field(s.defaulted(s.string(), "")),
  company: f.field(s.defaulted(s.string(), "")),
});

export default createController(routes, {
  actions: {
    async assets(context) {
      return (
        (await assets.fetch(context.request)) ??
        new Response("Not Found", { status: 404 })
      );
    },

    async home(context) {
      let database = context.get(databaseContext);
      if (!(await isSiteEnabled(database))) {
        return context.render(<SiteClosedPage />, {
          headers: { "Cache-Control": "no-store" },
        });
      }
      let publicIssues = await findPublicIssues(database);

      return context.render(<HomePage issues={publicIssues} />, {
        headers: { "Cache-Control": "no-store" },
      });
    },

    async write(context) {
      let database = context.get(databaseContext);
      if (!(await isSiteEnabled(database))) {
        return context.render(<SiteClosedPage />, {
          headers: { "Cache-Control": "no-store" },
        });
      }

      return context.render(
        <WritePage
          draftToken={randomUUID()}
          sent={context.url.searchParams.get("sent") === "1"}
        />,
        { headers: { "Cache-Control": "no-store" } },
      );
    },

    async issue(context) {
      let database = context.get(databaseContext);
      if (!(await isSiteEnabled(database))) {
        return context.render(<SiteClosedPage />, {
          headers: { "Cache-Control": "no-store" },
        });
      }

      let issueId = readId(context.params.issueId);
      if (issueId === null)
        return new Response("Letter not found.", { status: 404 });

      let issue = await database.find(issues, issueId);
      if (
        !issue ||
        issue.state !== "published" ||
        issue.published_at === null
      ) {
        return new Response("Letter not found.", { status: 404 });
      }

      let links = await database.findMany(issueLetters, {
        where: { issue_id: issue.id },
        orderBy: ["position", "asc"],
      });

      return context.render(
        <IssuePage
          issue={toPublicIssue(
            { ...issue, published_at: issue.published_at },
            links,
          )}
        />,
        {
          headers: { "Cache-Control": "no-store" },
        },
      );
    },

    async createLetter(context) {
      let origin = context.request.headers.get("origin");
      if (origin && origin !== new URL(context.request.url).origin) {
        return new Response("Cross-origin form submissions are not allowed.", {
          status: 403,
        });
      }

      let database = context.get(databaseContext);
      if (!(await isSiteEnabled(database))) {
        return context.render(<SiteClosedPage />, {
          status: 503,
          headers: { "Cache-Control": "no-store" },
        });
      }

      let formValue = await context.request.formData();
      let parsed = s.parseSafe(letterFormSchema, formValue, {
        errorMap({ code, defaultMessage }) {
          if (code === "string.min_length")
            return "This field cannot be empty.";
          if (code === "string.max_length") return "This is too long.";
          return defaultMessage;
        },
      });

      let attachmentStore = context.get(attachmentStoreContext);

      if (!parsed.success) {
        return context.render(
          <WritePage
            draftToken={readText(formValue, "draftToken") || randomUUID()}
            errors={issuesToErrors(parsed.issues)}
            values={readFormValues(formValue)}
          />,
          { status: 400, headers: { "Cache-Control": "no-store" } },
        );
      }

      if (parsed.value.company !== "") {
        return redirect(`${routes.write.href()}?sent=1#write`, 303);
      }

      let richText;
      try {
        richText = normalizeRichText({
          fallback: parsed.value.body,
          json: parsed.value.bodyJson,
        });
      } catch (error) {
        if (!(error instanceof RichTextValidationError)) throw error;
        return context.render(
          <WritePage
            draftToken={parsed.value.draftToken}
            errors={{ body: error.message }}
            values={readFormValues(formValue)}
          />,
          { status: 400, headers: { "Cache-Control": "no-store" } },
        );
      }

      let created = await database
        .transaction(async (transaction) => {
          if (richText.attachmentIds.length > 0) {
            let candidates = await transaction.findMany(attachments, {
              where: inList(attachments.id, richText.attachmentIds),
            });
            if (
              candidates.length !== richText.attachmentIds.length ||
              candidates.some(
                (attachment) =>
                  attachment.draft_token !== parsed.value.draftToken ||
                  attachment.letter_id !== null,
              )
            ) {
              throw new AttachmentClaimError();
            }
          }

          let letter = await transaction.create(
            letters,
            {
              author: parsed.value.author,
              email: parsed.value.email || null,
              body: richText.text,
              body_json: richText.json,
              font_key: normalizeFontKey(parsed.value.fontKey),
              can_publish: parsed.value.canPublish === "yes",
              state: "inbox",
              created_at: Date.now(),
              private_replied_at: null,
            },
            { returnRow: true },
          );

          for (let attachmentId of richText.attachmentIds) {
            await transaction.update(attachments, attachmentId, {
              letter_id: letter.id,
            });
          }
          return letter;
        })
        .catch((error: unknown) => {
          if (error instanceof AttachmentClaimError) return null;
          throw error;
        });

      if (!created) {
        return context.render(
          <WritePage
            draftToken={parsed.value.draftToken}
            errors={{
              body: "One of these images expired. Remove it and add it again.",
            }}
            values={readFormValues(formValue)}
          />,
          { status: 409, headers: { "Cache-Control": "no-store" } },
        );
      }

      await attachmentStore.removeUnclaimedForDraft(
        parsed.value.draftToken,
        richText.attachmentIds,
      );

      return redirect(`${routes.write.href()}?sent=1#write`, 303);
    },
  },
});

async function findPublicIssues(
  database: SqliteDatabase,
): Promise<PublicIssue[]> {
  let published = await database.findMany(issues, {
    where: { state: "published" },
    orderBy: ["published_at", "desc"],
    limit: 48,
  });
  let publishedWithDates = published.filter(
    (issue): issue is Issue & { published_at: number } =>
      issue.published_at !== null,
  );

  if (publishedWithDates.length === 0) return [];

  let links = await database.findMany(issueLetters, {
    where: inList(
      issueLetters.issue_id,
      publishedWithDates.map((issue) => issue.id),
    ),
    orderBy: [
      ["issue_id", "asc"],
      ["position", "asc"],
    ],
  });

  return publishedWithDates.map((issue) =>
    toPublicIssue(
      issue,
      links.filter((link) => link.issue_id === issue.id),
    ),
  );
}

function toPublicIssue(
  issue: Issue & { published_at: number },
  links: Array<{
    font_key: string;
    public_author: string;
    public_body: string;
    public_body_json: string | null;
  }>,
): PublicIssue {
  return {
    id: issue.id,
    letters: links.map((link) => ({
      author: link.public_author,
      body: link.public_body,
      bodyJson: link.public_body_json,
      fontKey: normalizeFontKey(link.font_key),
    })),
    publishedAt: issue.published_at,
    response: issue.response,
    responseJson: issue.response_json,
  };
}

function issuesToErrors(validationIssues: readonly s.Issue[]): FormErrors {
  let errors: FormErrors = {};

  for (let issue of validationIssues) {
    let firstPath = issue.path?.[0];
    let field =
      typeof firstPath === "object" && firstPath !== null && "key" in firstPath
        ? String(firstPath.key)
        : String(firstPath ?? "form");

    if (!errors[field]) errors[field] = issue.message;
  }

  return errors;
}

function readFormValues(formValue: FormData): LetterFormValues {
  let body = readText(formValue, "body");
  return {
    author: readText(formValue, "author"),
    email: readText(formValue, "email"),
    body,
    bodyJson: readSafeBodyJson(readText(formValue, "bodyJson"), body),
    canPublish: readText(formValue, "canPublish") === "yes",
    fontKey: normalizeFontKey(readText(formValue, "fontKey")),
  };
}

function readSafeBodyJson(json: string, fallback: string): string {
  if (!json) return "";
  try {
    return normalizeRichText({ allowEmpty: true, fallback, json }).json;
  } catch {
    return "";
  }
}

class AttachmentClaimError extends Error {}

function readId(value: string | undefined): number | null {
  let id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function readText(formValue: FormData, name: string): string {
  let value = formValue.get(name);
  return typeof value === "string" ? value : "";
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
