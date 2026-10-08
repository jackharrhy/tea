import * as s from "remix/data-schema";
import { maxLength, minLength } from "remix/data-schema/checks";
import { inList } from "remix/data-table/operators";
import type { SqliteDatabase } from "remix/data-table/sqlite";
import { createController } from "remix/router";
import { redirect } from "remix/response/redirect";

import {
  attachments,
  fontKeys,
  issueLetters,
  issues,
  letters,
} from "../../data/schema.ts";
import { isSiteEnabled, setSiteEnabled } from "../../data/site-settings.ts";
import { databaseContext } from "../../middleware/database.ts";
import { routes } from "../../routes.ts";
import {
  MAX_RICH_TEXT_BYTES,
  normalizeFontKey,
  normalizeRichText,
  RichTextValidationError,
  type NormalizedRichText,
} from "../../ui/rich-text.tsx";
import { challengeSteve, getSteveAccess } from "./auth.ts";
import { SteveInboxPage, type AdminIssue } from "./inbox-page.tsx";

const trimmedString = s.string().transform((value) => value.trim());
const positiveId = s
  .string()
  .transform((value) => Number(value))
  .refine(
    (value) => Number.isSafeInteger(value) && value > 0,
    "Choose a valid letter.",
  );

const createIssueSchema = s.object({
  intent: s.enum_(["draft", "publish"] as const),
  letterIds: s.array(positiveId),
  response: s.string().pipe(maxLength(5000)),
  responseJson: s.string().pipe(maxLength(MAX_RICH_TEXT_BYTES)),
});

const updateIssueSchema = s.object({
  intent: s.enum_(["save", "publish", "unpublish", "discard"] as const),
  response: s.string().pipe(maxLength(5000)),
  responseJson: s.string().pipe(maxLength(MAX_RICH_TEXT_BYTES)),
});

const updateLetterSchema = s.object({
  intent: s.enum_(["archive", "restore", "private-replied"] as const),
});

const updateSiteSchema = s.object({
  enabled: s.enum_(["on", "off"] as const),
});

const publicLetterSchema = s.object({
  author: trimmedString.pipe(minLength(1), maxLength(40)),
  body: s.string().pipe(maxLength(5000)),
  bodyJson: s.string().pipe(maxLength(MAX_RICH_TEXT_BYTES)),
  fontKey: s.enum_(fontKeys),
});

export default createController(routes.steve, {
  actions: {
    async index(context) {
      let access = getSteveAccess(context.request);
      if (access === "unconfigured") {
        return context.render(<SteveInboxPage letters={[]} setupRequired />, {
          status: 503,
          headers: { "Cache-Control": "no-store" },
        });
      }
      if (access === "unauthorized") return challengeSteve();

      let database = context.get(databaseContext);
      let [siteEnabled, allLetters, allIssues, allLinks] = await Promise.all([
        isSiteEnabled(database),
        database.findMany(letters, { orderBy: ["created_at", "desc"] }),
        database.findMany(issues, { orderBy: ["updated_at", "desc"] }),
        database.findMany(issueLetters, {
          orderBy: [
            ["issue_id", "asc"],
            ["position", "asc"],
          ],
        }),
      ]);
      let originals = new Map(allLetters.map((letter) => [letter.id, letter]));
      let adminIssues: AdminIssue[] = allIssues.map((issue) => ({
        ...issue,
        letters: allLinks
          .filter((link) => link.issue_id === issue.id)
          .map((link) => {
            let original = originals.get(link.letter_id);
            return {
              ...link,
              originalAuthor: original?.author ?? link.public_author,
              originalBody: original?.body ?? link.public_body,
              originalBodyJson: original?.body_json ?? link.public_body_json,
              originalFontKey: original?.font_key ?? link.font_key,
            };
          }),
      }));

      return context.render(
        <SteveInboxPage
          issues={adminIssues}
          letters={allLetters}
          siteEnabled={siteEnabled}
        />,
        {
          headers: { "Cache-Control": "no-store" },
        },
      );
    },

    async updateSite(context) {
      let rejection = requireSteveAction(context.request);
      if (rejection) return rejection;

      let form = await context.request.formData();
      let parsed = s.parseSafe(updateSiteSchema, {
        enabled: readText(form, "enabled"),
      });
      if (!parsed.success)
        return new Response("Unknown site setting.", { status: 400 });

      let database = context.get(databaseContext);
      await setSiteEnabled(database, parsed.value.enabled === "on");
      return redirect(`${routes.steve.index.href()}#site-availability`, 303);
    },

    async createIssue(context) {
      let rejection = requireSteveAction(context.request);
      if (rejection) return rejection;

      let form = await context.request.formData();
      let parsed = s.parseSafe(createIssueSchema, {
        intent: readText(form, "intent"),
        letterIds: form
          .getAll("letterId")
          .map((value) => (typeof value === "string" ? value : "")),
        response: readText(form, "response"),
        responseJson: readText(form, "responseJson"),
      });
      if (!parsed.success) {
        return new Response(
          "Choose letters and write a reply of no more than 5000 characters.",
          {
            status: 400,
          },
        );
      }

      let letterIds = [...new Set(parsed.value.letterIds)];
      if (letterIds.length === 0) {
        return new Response("Choose at least one letter.", { status: 400 });
      }
      let richResponse = readRichText(
        parsed.value.responseJson,
        parsed.value.response,
        {
          allowEmpty: true,
          allowImages: false,
        },
      );
      if (richResponse instanceof Response) return richResponse;
      if (parsed.value.intent === "publish" && richResponse.text.length === 0) {
        return new Response("Write Steve's reply before publishing.", {
          status: 400,
        });
      }

      let database = context.get(databaseContext);
      let issue = await database
        .transaction(async (transaction) => {
          let selected = await transaction.findMany(letters, {
            where: inList(letters.id, letterIds),
          });
          let selectedById = new Map(
            selected.map((letter) => [letter.id, letter]),
          );
          let ordered = letterIds.map((id) => selectedById.get(id));

          if (
            ordered.some(
              (letter) =>
                !letter || !letter.can_publish || letter.state !== "inbox",
            )
          ) {
            throw new EditorialConflict(
              "Only publishable inbox letters can be included.",
            );
          }

          let now = Date.now();
          let created = await transaction.create(
            issues,
            {
              response: richResponse.text,
              response_json: richResponse.json,
              state: parsed.value.intent === "publish" ? "published" : "draft",
              created_at: now,
              updated_at: now,
              published_at: parsed.value.intent === "publish" ? now : null,
            },
            { returnRow: true },
          );

          await transaction.createMany(
            issueLetters,
            ordered.map((letter, position) => ({
              issue_id: created.id,
              letter_id: letter!.id,
              position,
              public_author: letter!.author,
              public_body: letter!.body,
              public_body_json: letter!.body_json,
              font_key: letter!.font_key,
            })),
          );

          if (parsed.value.intent === "publish") {
            await syncPublicAttachments(
              transaction,
              ordered.map((letter) => ({
                attachmentIds: readStoredAttachmentIds(
                  letter!.body_json,
                  letter!.body,
                ),
                letterId: letter!.id,
              })),
              true,
            );
          }

          await transaction.updateMany(
            letters,
            {
              state: parsed.value.intent === "publish" ? "published" : "draft",
            },
            { where: inList(letters.id, letterIds) },
          );

          return created;
        })
        .catch(editorialConflictResponse);

      if (issue instanceof Response) return issue;
      return redirect(`${routes.steve.index.href()}#issue-${issue.id}`, 303);
    },

    async updateIssue(context) {
      let rejection = requireSteveAction(context.request);
      if (rejection) return rejection;

      let issueId = readId(context.params.issueId);
      if (issueId === null)
        return new Response("Letter not found.", { status: 404 });

      let form = await context.request.formData();
      let parsed = s.parseSafe(updateIssueSchema, {
        intent: readText(form, "intent"),
        response: readText(form, "response"),
        responseJson: readText(form, "responseJson"),
      });
      if (!parsed.success) {
        return new Response("Write a reply of no more than 5000 characters.", {
          status: 400,
        });
      }

      let richResponse = readRichText(
        parsed.value.responseJson,
        parsed.value.response,
        {
          allowEmpty: true,
          allowImages: false,
        },
      );
      if (richResponse instanceof Response) return richResponse;

      let database = context.get(databaseContext);
      let result = await database
        .transaction(async (transaction) => {
          let issue = await transaction.find(issues, issueId);
          if (!issue) throw new EditorialNotFound();

          let links = await transaction.findMany(issueLetters, {
            where: { issue_id: issueId },
            orderBy: ["position", "asc"],
          });
          if (links.length === 0)
            throw new EditorialConflict("This issue has no letters.");

          if (parsed.value.intent === "discard") {
            if (issue.state !== "draft") {
              throw new EditorialConflict(
                "Published letters must be unpublished first.",
              );
            }
            await transaction.updateMany(
              letters,
              { state: "inbox" },
              {
                where: inList(
                  letters.id,
                  links.map((link) => link.letter_id),
                ),
              },
            );
            await syncPublicAttachments(
              transaction,
              links.map((link) => ({
                attachmentIds: [],
                letterId: link.letter_id,
              })),
              false,
            );
            await transaction.delete(issues, issue.id);
            return { discarded: true };
          }

          if (
            parsed.value.intent === "publish" &&
            richResponse.text.length === 0
          ) {
            throw new EditorialConflict(
              "Write Steve's reply before publishing.",
            );
          }
          if (issue.state === "published" && richResponse.text.length === 0) {
            throw new EditorialConflict("A published reply cannot be empty.");
          }

          let attachmentSets: Array<{
            attachmentIds: string[];
            letterId: number;
          }> = [];
          for (let link of links) {
            let publicLetter = s.parseSafe(publicLetterSchema, {
              author: readText(form, `author-${link.id}`),
              body: readText(form, `body-${link.id}`),
              bodyJson: readText(form, `bodyJson-${link.id}`),
              fontKey: readText(form, `fontKey-${link.id}`) || "handwritten",
            });
            if (!publicLetter.success) {
              throw new EditorialConflict(
                "Each published letter needs a name and message.",
              );
            }
            let richLetter = readRichText(
              publicLetter.value.bodyJson,
              publicLetter.value.body,
            );
            if (richLetter instanceof Response) {
              throw new EditorialConflict(await richLetter.text());
            }
            await assertAttachmentsBelongToLetter(
              transaction,
              link.letter_id,
              richLetter.attachmentIds,
            );
            await transaction.update(issueLetters, link.id, {
              public_author: publicLetter.value.author,
              public_body: richLetter.text,
              public_body_json: richLetter.json,
              font_key: normalizeFontKey(publicLetter.value.fontKey),
            });
            attachmentSets.push({
              attachmentIds: richLetter.attachmentIds,
              letterId: link.letter_id,
            });
          }

          let now = Date.now();
          if (parsed.value.intent === "unpublish") {
            if (issue.state !== "published") {
              throw new EditorialConflict("This issue is already a draft.");
            }
            await transaction.update(issues, issue.id, {
              response: richResponse.text,
              response_json: richResponse.json,
              state: "draft",
              updated_at: now,
              published_at: null,
            });
            await transaction.updateMany(
              letters,
              { state: "draft" },
              {
                where: inList(
                  letters.id,
                  links.map((link) => link.letter_id),
                ),
              },
            );
            await syncPublicAttachments(transaction, attachmentSets, false);
          } else if (parsed.value.intent === "publish") {
            await transaction.update(issues, issue.id, {
              response: richResponse.text,
              response_json: richResponse.json,
              state: "published",
              updated_at: now,
              published_at: issue.published_at ?? now,
            });
            await transaction.updateMany(
              letters,
              { state: "published" },
              {
                where: inList(
                  letters.id,
                  links.map((link) => link.letter_id),
                ),
              },
            );
            await syncPublicAttachments(transaction, attachmentSets, true);
          } else {
            await transaction.update(issues, issue.id, {
              response: richResponse.text,
              response_json: richResponse.json,
              updated_at: now,
            });
            await syncPublicAttachments(
              transaction,
              attachmentSets,
              issue.state === "published",
            );
          }

          return { discarded: false };
        })
        .catch(editorialConflictResponse);

      if (result instanceof Response) return result;
      return redirect(
        result.discarded
          ? routes.steve.index.href()
          : `${routes.steve.index.href()}#issue-${issueId}`,
        303,
      );
    },

    async updateLetter(context) {
      let rejection = requireSteveAction(context.request);
      if (rejection) return rejection;

      let letterId = readId(context.params.letterId);
      if (letterId === null)
        return new Response("Letter not found.", { status: 404 });

      let form = await context.request.formData();
      let parsed = s.parseSafe(updateLetterSchema, {
        intent: readText(form, "intent"),
      });
      if (!parsed.success)
        return new Response("Unknown letter action.", { status: 400 });

      let database = context.get(databaseContext);
      let letter = await database.find(letters, letterId);
      if (!letter) return new Response("Letter not found.", { status: 404 });

      if (parsed.value.intent === "restore") {
        if (letter.state !== "archived") {
          return new Response("Only archived letters can be restored.", {
            status: 409,
          });
        }
        await database.update(letters, letter.id, { state: "inbox" });
      } else if (parsed.value.intent === "archive") {
        if (letter.state !== "inbox") {
          return new Response("Only inbox letters can be archived.", {
            status: 409,
          });
        }
        await database.update(letters, letter.id, { state: "archived" });
      } else {
        if (letter.state !== "inbox" || !letter.email) {
          return new Response("This letter cannot be marked replied.", {
            status: 409,
          });
        }
        await database.update(letters, letter.id, {
          private_replied_at: Date.now(),
          state: "archived",
        });
      }

      return redirect(`${routes.steve.index.href()}#letter-${letterId}`, 303);
    },
  },
});

class EditorialConflict extends Error {}
class EditorialNotFound extends Error {}

function editorialConflictResponse(error: unknown): Response {
  if (error instanceof EditorialNotFound) {
    return new Response("Letter not found.", { status: 404 });
  }
  if (error instanceof EditorialConflict) {
    return new Response(error.message, { status: 409 });
  }
  throw error;
}

function requireSteveAction(request: Request): Response | null {
  let access = getSteveAccess(request);
  if (access === "unconfigured") {
    return new Response("Admin password is not configured.", { status: 503 });
  }
  if (access === "unauthorized") return challengeSteve();

  let origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return new Response("Cross-origin form submissions are not allowed.", {
      status: 403,
    });
  }
  return null;
}

function readId(value: string | undefined): number | null {
  let id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function readText(form: FormData, name: string): string {
  let value = form.get(name);
  return typeof value === "string" ? value : "";
}

function readRichText(
  json: string,
  fallback: string,
  options: { allowEmpty?: boolean; allowImages?: boolean } = {},
): NormalizedRichText | Response {
  try {
    return normalizeRichText({ json, fallback, ...options });
  } catch (error) {
    if (error instanceof RichTextValidationError) {
      return new Response(error.message, { status: 400 });
    }
    throw error;
  }
}

function readStoredAttachmentIds(
  json: string | null,
  fallback: string,
): string[] {
  try {
    return normalizeRichText({ json, fallback }).attachmentIds;
  } catch {
    return [];
  }
}

async function assertAttachmentsBelongToLetter(
  database: SqliteDatabase,
  letterId: number,
  attachmentIds: string[],
) {
  if (attachmentIds.length === 0) return;
  let owned = await database.findMany(attachments, {
    where: inList(attachments.id, attachmentIds),
  });
  if (
    owned.length !== attachmentIds.length ||
    owned.some((attachment) => attachment.letter_id !== letterId)
  ) {
    throw new EditorialConflict(
      "A published letter contains an image it does not own.",
    );
  }
}

async function syncPublicAttachments(
  database: SqliteDatabase,
  letterDocuments: Array<{ attachmentIds: string[]; letterId: number }>,
  makePublic: boolean,
) {
  for (let letterDocument of letterDocuments) {
    let owned = await database.findMany(attachments, {
      where: { letter_id: letterDocument.letterId },
    });
    let publicIds = makePublic
      ? new Set(letterDocument.attachmentIds)
      : new Set<string>();
    for (let attachment of owned) {
      let isPublic = publicIds.has(attachment.id);
      if (attachment.is_public !== isPublic) {
        await database.update(attachments, attachment.id, {
          is_public: isPublic,
        });
      }
    }
  }
}
