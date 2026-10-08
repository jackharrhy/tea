import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import * as assert from "remix/assert";
import { describe, it } from "remix/test";
import sharp from "sharp";

import { createAppRouter } from "../../router.ts";
import { routes } from "../../routes.ts";

describe("editorial letter routes", () => {
  it("keeps submissions private until Steve publishes a grouped issue", async () => {
    let previousPassword = process.env.STEVE_ADMIN_PASSWORD;
    process.env.STEVE_ADMIN_PASSWORD = "test-secret";

    let { database, router } = await createAppRouter({
      databasePath: ":memory:",
    });

    try {
      assert.match(
        await (await router.fetch(request(routes.home.href()))).text(),
        /class="site-closed-shell"/,
      );
      assert.equal(
        (
          await postForm(router, routes.steve.updateSite.href(), {
            enabled: "on",
          })
        ).status,
        303,
      );

      let initialHomeHtml = await (
        await router.fetch(request(routes.home.href()))
      ).text();
      assert.match(initialHomeHtml, /href="\/write"[^>]*>\s*write to steve/);
      assert.match(initialHomeHtml, /href="\/steve"[^>]*>\s*steve login/);
      assert.doesNotMatch(initialHomeHtml, /name="body"/);

      let writeResponse = await router.fetch(request(routes.write.href()));
      let writeHtml = await writeResponse.text();
      assert.equal(writeResponse.status, 200);
      assert.match(writeHtml, /<h1[^>]*>dear steve,/);
      assert.match(writeHtml, /class="[^"]*letter-textarea/);
      assert.match(writeHtml, /placeholder="Write your letter here\.\.\."/);
      assert.match(
        writeHtml,
        /rel="preload"[^>]+shantell-sans-latin-wght-normal\.woff2/,
      );

      let invalidResponse = await submitLetter(router, {
        author: "",
        body: "",
        canPublish: true,
        email: "not-an-email",
      });
      assert.equal(invalidResponse.status, 400);
      assert.match(await invalidResponse.text(), /Write to Steve/);

      let firstLetterResponse = await submitLetter(router, {
        author: "Mira",
        body: "Could a small habit change a life?",
        canPublish: true,
        email: "mira@example.com",
      });
      assert.equal(firstLetterResponse.status, 303);
      assert.equal(
        firstLetterResponse.headers.get("Location"),
        "/write?sent=1#write",
      );
      assert.equal(
        (
          await submitLetter(router, {
            author: "Rowan",
            body: "How do you begin again?",
            canPublish: true,
            email: "",
          })
        ).status,
        303,
      );
      assert.equal(
        (
          await submitLetter(router, {
            author: "Noah",
            body: "A note meant only for Steve.",
            canPublish: false,
            email: "noah@example.com",
          })
        ).status,
        303,
      );

      let homeHtml = await (
        await router.fetch(request(routes.home.href()))
      ).text();
      assert.doesNotMatch(homeHtml, /Could a small habit/);
      assert.doesNotMatch(homeHtml, /How do you begin/);
      assert.doesNotMatch(homeHtml, /A note meant only/);
      assert.doesNotMatch(homeHtml, /example\.com/);

      let unauthorizedResponse = await router.fetch(
        request(routes.steve.index.href()),
      );
      assert.equal(unauthorizedResponse.status, 401);
      assert.match(
        unauthorizedResponse.headers.get("WWW-Authenticate") ?? "",
        /Basic/,
      );

      let inboxResponse = await router.fetch(
        request(routes.steve.index.href(), { headers: steveHeaders() }),
      );
      let inboxHtml = await inboxResponse.text();
      assert.equal(inboxResponse.status, 200);
      assert.match(inboxHtml, /role="switch"[^>]+aria-checked="true"/);
      assert.match(inboxHtml, /Could a small habit/);
      assert.match(inboxHtml, /How do you begin/);
      assert.match(inboxHtml, /A note meant only/);
      assert.match(inboxHtml, /mailto:noah%40example\.com/);

      let privateIssueResponse = await postForm(
        router,
        routes.steve.createIssue.href(),
        {
          intent: "draft",
          letterId: ["3"],
          response: "",
        },
      );
      assert.equal(privateIssueResponse.status, 409);

      let draftResponse = await postForm(
        router,
        routes.steve.createIssue.href(),
        {
          intent: "draft",
          letterId: ["1", "2"],
          response: "A beginning of an answer.",
        },
      );
      assert.equal(draftResponse.status, 303);

      homeHtml = await (await router.fetch(request(routes.home.href()))).text();
      assert.doesNotMatch(homeHtml, /A beginning of an answer/);
      assert.equal(
        (await router.fetch(request(routes.issue.href({ issueId: "1" }))))
          .status,
        404,
      );

      let publishResponse = await postForm(
        router,
        routes.steve.updateIssue.href({ issueId: "1" }),
        {
          "author-1": "Mira, edited",
          "author-2": "Rowan",
          "body-1": "Could a small habit change a life?",
          "body-2": "How do you begin again?",
          intent: "publish",
          response: "Begin with the thing small enough to do today.",
        },
      );
      assert.equal(publishResponse.status, 303);

      let publishedHome = await router.fetch(request(routes.home.href()));
      let publishedHtml = await publishedHome.text();
      assert.equal(publishedHome.status, 200);
      assert.match(publishedHtml, /Mira, edited/);
      assert.match(publishedHtml, /Could a small habit/);
      assert.match(publishedHtml, /How do you begin/);
      assert.match(publishedHtml, /Begin with the thing small enough/);
      assert.doesNotMatch(publishedHtml, /A note meant only/);
      assert.doesNotMatch(publishedHtml, /example\.com/);

      let issueResponse = await router.fetch(
        request(routes.issue.href({ issueId: "1" })),
      );
      assert.equal(issueResponse.status, 200);
      assert.match(
        await issueResponse.text(),
        /Begin with the thing small enough/,
      );

      let editedInboxHtml = await (
        await router.fetch(
          request(routes.steve.index.href(), { headers: steveHeaders() }),
        )
      ).text();
      assert.match(editedInboxHtml, /original/);
      assert.match(editedInboxHtml, />Mira</);

      let unpublishResponse = await postForm(
        router,
        routes.steve.updateIssue.href({ issueId: "1" }),
        {
          "author-1": "Mira, edited",
          "author-2": "Rowan",
          "body-1": "Could a small habit change a life?",
          "body-2": "How do you begin again?",
          intent: "unpublish",
          response: "Begin with the thing small enough to do today.",
        },
      );
      assert.equal(unpublishResponse.status, 303);
      assert.doesNotMatch(
        await (await router.fetch(request(routes.home.href()))).text(),
        /Begin with the thing small enough/,
      );

      let privateReplyResponse = await postForm(
        router,
        routes.steve.updateLetter.href({ letterId: "3" }),
        { intent: "private-replied" },
      );
      assert.equal(privateReplyResponse.status, 303);

      let restoreResponse = await postForm(
        router,
        routes.steve.updateLetter.href({ letterId: "3" }),
        { intent: "restore" },
      );
      assert.equal(restoreResponse.status, 303);
    } finally {
      await database.close();
      if (previousPassword === undefined)
        delete process.env.STEVE_ADMIN_PASSWORD;
      else process.env.STEVE_ADMIN_PASSWORD = previousPassword;
    }
  });

  it("lets Steve close and reopen every public route", async () => {
    let previousPassword = process.env.STEVE_ADMIN_PASSWORD;
    process.env.STEVE_ADMIN_PASSWORD = "test-secret";
    let { database, router } = await createAppRouter({
      databasePath: ":memory:",
    });

    try {
      assert.match(
        await (await router.fetch(request(routes.home.href()))).text(),
        /class="site-closed-shell"/,
      );
      assert.equal(
        (
          await postForm(router, routes.steve.updateSite.href(), {
            enabled: "on",
          })
        ).status,
        303,
      );

      let closeResponse = await postForm(
        router,
        routes.steve.updateSite.href(),
        {
          enabled: "off",
        },
      );
      assert.equal(closeResponse.status, 303);
      assert.equal(
        closeResponse.headers.get("Location"),
        "/steve#site-availability",
      );

      for (let pathname of [
        routes.home.href(),
        routes.write.href(),
        "/letters/999",
      ]) {
        let response = await router.fetch(request(pathname));
        let html = await response.text();
        assert.equal(response.status, 200);
        assert.match(html, /class="site-closed-shell"/);
        assert.match(html, /src="\/steve\.png"[^>]+alt="Steve"/);
        assert.match(html, /href="\/steve"[^>]*>\s*steve login/);
        assert.doesNotMatch(html, /write to steve/);
        assert.doesNotMatch(html, /<script type="module"/);
      }

      let staleSubmission = await submitLetter(router, {
        author: "Mira",
        body: "Sent from a page that was already open.",
        canPublish: true,
        email: "",
      });
      assert.equal(staleSubmission.status, 503);
      assert.match(await staleSubmission.text(), /class="site-closed-shell"/);

      let uploadForm = new FormData();
      uploadForm.set(
        "image",
        new File([new Uint8Array([1])], "note.png", { type: "image/png" }),
      );
      let closedUpload = await router.fetch(
        request(routes.uploads.create.href(), {
          body: uploadForm,
          headers: {
            Origin: "http://letters.test",
            "X-Draft-Token": randomUUID(),
          },
          method: "POST",
        }),
      );
      assert.equal(closedUpload.status, 503);
      assert.deepEqual(await closedUpload.json(), {
        error: "Letters are closed right now.",
      });

      let closedInbox = await router.fetch(
        request(routes.steve.index.href(), { headers: steveHeaders() }),
      );
      assert.equal(closedInbox.status, 200);
      assert.match(
        await closedInbox.text(),
        /role="switch"[^>]+aria-checked="false"/,
      );

      let openResponse = await postForm(
        router,
        routes.steve.updateSite.href(),
        {
          enabled: "on",
        },
      );
      assert.equal(openResponse.status, 303);

      let reopenedHtml = await (
        await router.fetch(request(routes.home.href()))
      ).text();
      assert.match(reopenedHtml, /write to steve/);
      assert.doesNotMatch(reopenedHtml, /site-closed-shell/);
    } finally {
      await database.close();
      if (previousPassword === undefined)
        delete process.env.STEVE_ADMIN_PASSWORD;
      else process.env.STEVE_ADMIN_PASSWORD = previousPassword;
    }
  });

  it("processes, owns, and publishes images inside rich letters", async () => {
    let previousPassword = process.env.STEVE_ADMIN_PASSWORD;
    process.env.STEVE_ADMIN_PASSWORD = "test-secret";
    let uploadDirectory = await mkdtemp(
      path.join(tmpdir(), "letters-to-steve-"),
    );
    let { database, router } = await createAppRouter({
      databasePath: ":memory:",
      uploadDirectory,
    });

    try {
      assert.equal(
        (
          await postForm(router, routes.steve.updateSite.href(), {
            enabled: "on",
          })
        ).status,
        303,
      );

      let draftToken = randomUUID();
      let sourceImage = await sharp({
        create: {
          background: { alpha: 1, b: 196, g: 214, r: 231 },
          channels: 4,
          height: 1600,
          width: 3200,
        },
      })
        .png()
        .toBuffer();

      let uploadForm = new FormData();
      uploadForm.set(
        "image",
        new File([sourceImage], "sky.png", { type: "image/png" }),
      );
      let uploadResponse = await router.fetch(
        request(routes.uploads.create.href(), {
          body: uploadForm,
          headers: {
            Origin: "http://letters.test",
            "X-Draft-Token": draftToken,
          },
          method: "POST",
        }),
      );
      assert.equal(uploadResponse.status, 201);
      let upload = (await uploadResponse.json()) as {
        height: number;
        id: string;
        mimeType: string;
        src: string;
        width: number;
      };
      assert.equal(upload.mimeType, "image/webp");
      assert.equal(upload.width, 2400);
      assert.equal(upload.height, 1200);

      let privateImage = await router.fetch(request(upload.src));
      assert.equal(privateImage.status, 200);
      assert.equal(privateImage.headers.get("Content-Type"), "image/webp");
      assert.match(privateImage.headers.get("Cache-Control") ?? "", /private/);

      let richLetter = JSON.stringify({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "A rich ", marks: [{ type: "italic" }] },
              { type: "text", text: "letter", marks: [{ type: "bold" }] },
              { type: "text", text: " for Steve." },
            ],
          },
          {
            type: "image",
            attrs: {
              alt: "A pale blue field",
              height: upload.height,
              src: upload.src,
              width: upload.width,
            },
          },
        ],
      });
      let createResponse = await submitLetter(router, {
        author: "Ari",
        body: "A rich letter for Steve.",
        bodyJson: richLetter,
        canPublish: true,
        draftToken,
        email: "",
        fontKey: "handwritten",
      });
      assert.equal(createResponse.status, 303);

      let inboxHtml = await (
        await router.fetch(
          request(routes.steve.index.href(), { headers: steveHeaders() }),
        )
      ).text();
      assert.match(inboxHtml, /font-handwritten/);
      assert.match(inboxHtml, /A pale blue field/);
      assert.match(inboxHtml, /<strong[^>]*>letter<\/strong>/);

      let richReply = JSON.stringify({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "A proper " },
              { type: "text", text: "reply.", marks: [{ type: "italic" }] },
            ],
          },
        ],
      });
      let publishResponse = await postForm(
        router,
        routes.steve.createIssue.href(),
        {
          intent: "publish",
          letterId: ["1"],
          response: "A proper reply.",
          responseJson: richReply,
        },
      );
      assert.equal(publishResponse.status, 303);

      let publishedHtml = await (
        await router.fetch(request(routes.home.href()))
      ).text();
      assert.match(publishedHtml, /A pale blue field/);
      assert.match(publishedHtml, /<em[^>]*>reply\.<\/em>/);
      assert.match(publishedHtml, /steve-prose/);

      let publicImage = await router.fetch(request(upload.src));
      assert.equal(
        publicImage.headers.get("Cache-Control"),
        "private, no-cache",
      );

      await postForm(router, routes.steve.updateSite.href(), {
        enabled: "off",
      });
      assert.equal((await router.fetch(request(upload.src))).status, 404);
      assert.equal(
        (await router.fetch(request(upload.src, { headers: steveHeaders() })))
          .status,
        200,
      );
      await postForm(router, routes.steve.updateSite.href(), { enabled: "on" });

      let unsafeDocument = JSON.stringify({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "No." }] },
          { type: "image", attrs: { src: "https://example.com/tracker.png" } },
        ],
      });
      let unsafeResponse = await submitLetter(router, {
        author: "Eve",
        body: "No.",
        bodyJson: unsafeDocument,
        canPublish: false,
        email: "",
      });
      assert.equal(unsafeResponse.status, 400);

      let oversized = new FormData();
      oversized.set(
        "image",
        new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.png", {
          type: "image/png",
        }),
      );
      let oversizedResponse = await router.fetch(
        request(routes.uploads.create.href(), {
          body: oversized,
          headers: {
            Origin: "http://letters.test",
            "X-Draft-Token": randomUUID(),
          },
          method: "POST",
        }),
      );
      assert.equal(oversizedResponse.status, 413);
    } finally {
      await database.close();
      await rm(uploadDirectory, { force: true, recursive: true });
      if (previousPassword === undefined)
        delete process.env.STEVE_ADMIN_PASSWORD;
      else process.env.STEVE_ADMIN_PASSWORD = previousPassword;
    }
  });
});

async function submitLetter(
  router: Awaited<ReturnType<typeof createAppRouter>>["router"],
  values: {
    author: string;
    body: string;
    bodyJson?: string;
    canPublish: boolean;
    draftToken?: string;
    email: string;
    fontKey?: "handwritten" | "book" | "plain";
  },
): Promise<Response> {
  return postForm(
    router,
    routes.createLetter.href(),
    {
      author: values.author,
      body: values.body,
      bodyJson: values.bodyJson ?? "",
      canPublish: values.canPublish ? "yes" : undefined,
      company: "",
      draftToken: values.draftToken ?? "e9b1d519-8d62-4e3a-aa61-99b8f5942302",
      email: values.email,
      fontKey: values.fontKey ?? "handwritten",
    },
    false,
  );
}

async function postForm(
  router: Awaited<ReturnType<typeof createAppRouter>>["router"],
  pathname: string,
  values: Record<string, string | string[] | undefined>,
  authenticate = true,
): Promise<Response> {
  let form = new FormData();
  for (let [name, value] of Object.entries(values)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (let item of value) form.append(name, item);
    } else {
      form.set(name, value);
    }
  }

  return router.fetch(
    request(pathname, {
      body: form,
      headers: authenticate
        ? steveHeaders({ Origin: "http://letters.test" })
        : undefined,
      method: "POST",
    }),
  );
}

function request(pathname: string, init?: RequestInit): Request {
  return new Request(new URL(pathname, "http://letters.test"), init);
}

function steveHeaders(extra: Record<string, string> = {}): Headers {
  return new Headers({
    Authorization: `Basic ${Buffer.from("steve:test-secret").toString("base64")}`,
    ...extra,
  });
}
