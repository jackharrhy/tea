import { it } from "remix/test";
import * as assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adoptSite } from "../packages/teacms/app/data/adopt.ts";
import { openDatabase } from "../packages/teacms/app/data/database.ts";
import { ContentStore } from "../packages/teacms/app/data/content.ts";

it("adopts either legacy schema without copying migration history or changing the source", async () => {
  const dir = await mkdtemp(join(tmpdir(), "teacms-adoption-"));
  try {
    for (const variant of ["andrew", "luke"]) {
      const source = join(dir, variant),
        target = join(dir, variant + "-adopted");
      const { sqlite } = await openDatabase(join(source, "tea.db"));
      sqlite.exec(
        "ALTER TABLE site_preferences DROP COLUMN analytics_id; ALTER TABLE site_preferences DROP COLUMN analytics_enabled;",
      );
      if (variant === "luke") sqlite.exec("DROP TABLE adornments");
      sqlite
        .prepare(
          "INSERT INTO media(id,filename,mime_type,size,path) VALUES ('image','sample.png','image/png',4,'sample.png')",
        )
        .run();
      const store = new ContentStore(sqlite);
      const home = store.editorPage("")!;
      store.saveDraft(
        "",
        {
          ...home,
          blocks: [
            {
              id: "fixture",
              type: "paragraph",
              props: { custom: "preserved" },
              content: [{ type: "text", text: "Private draft" }],
            },
          ],
        },
        home.revision,
      );
      sqlite
        .prepare(
          "INSERT INTO users(email,password_hash) VALUES ('fixture@example.test','preserved-hash')",
        )
        .run();
      sqlite
        .prepare(
          "INSERT INTO sessions(id,user_id,expires_at) VALUES ('old',1,'2099-01-01')",
        )
        .run();
      if (variant === "andrew")
        sqlite
          .prepare(
            "INSERT INTO adornments(id,name,media_id,css) VALUES ('art','Fixture art','image','{}')",
          )
          .run();
      sqlite.close();
      await mkdir(join(source, "uploads"));
      await writeFile(join(source, "uploads/sample.png"), "test");
      const before = await readFile(join(source, "tea.db"));
      const counts = await adoptSite(source, target);
      assert.equal(counts.media, 1);
      assert.deepEqual(await readFile(join(source, "tea.db")), before);
      const adopted = await openDatabase(join(target, "tea.db"));
      try {
        assert.equal(
          new ContentStore(adopted.sqlite).editorPage("")!.blocks[0].props
            .custom,
          "preserved",
        );
        assert.equal(
          adopted.sqlite.prepare("SELECT count(*) n FROM sessions").get()?.n,
          0,
        );
        assert.equal(
          adopted.sqlite.prepare("SELECT password_hash FROM users").get()
            ?.password_hash,
          "preserved-hash",
        );
        assert.equal(
          new ContentStore(adopted.sqlite).adornments().length,
          variant === "andrew" ? 1 : 0,
        );
        assert.equal(
          await readFile(join(target, "uploads/sample.png"), "utf8"),
          "test",
        );
      } finally {
        adopted.sqlite.close();
      }
      await assert.rejects(adoptSite(source, target), /already exists/);
      const modified = new DatabaseSync(join(source, "tea.db"));
      modified.exec("ALTER TABLE homepage ADD COLUMN future_value TEXT");
      modified.close();
      await assert.rejects(adoptSite(source, target + "-future"), /lossy copy/);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
