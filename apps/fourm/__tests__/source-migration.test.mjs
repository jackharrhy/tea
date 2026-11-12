import { it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  utimes,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { schema } from "../app/data/schema.ts";
import { exportSource } from "../scripts/export-source.mjs";
import { createCommunity } from "../app/data/community.ts";

it("exports a read-only source copy and restores numeric ownership without legacy credentials", async () => {
  const root = await mkdtemp(join(tmpdir(), "fourm-source-transfer-"));
  const file = join(root, "source.sqlite");
  const uploads = join(root, "uploads");
  try {
    await mkdir(join(uploads, "jane"), { recursive: true });
    const bytes = Buffer.from("source fixture media");
    await writeFile(join(uploads, "jane/photo.txt"), bytes);
    await utimes(
      join(uploads, "jane/photo.txt"),
      new Date("2020-01-01T00:00:00Z"),
      new Date("2020-01-01T00:00:00Z"),
    );
    const source = new DatabaseSync(file);
    source.exec(schema);
    source.exec(
      "PRAGMA foreign_keys=ON;INSERT INTO users(id,username,display_name,password_hash,is_admin) VALUES(41,'jane','Jane','fixture-credential-must-not-transfer',1);INSERT INTO external_identities VALUES('https://fixture.example','exact-source-subject',41);INSERT INTO pages(id,user_id,slug,title,content,is_public) VALUES(19,41,'hello.world','Hello','Original content',0);CREATE TABLE oauth2_tokens(access_token TEXT);INSERT INTO oauth2_tokens VALUES('fixture-bearer-must-not-transfer');",
    );
    source
      .prepare(
        "INSERT INTO media(id,user_id,storage_path,mime_type,size_bytes) VALUES(7,41,'jane/photo.txt','text/plain',?)",
      )
      .run(bytes.length);
    source.close();
    const before = createHash("sha256")
      .update(await readFile(file))
      .digest("hex");
    const result = await exportSource({
      database: file,
      uploads,
      output: join(root, "archive"),
    });
    const text = await readFile(join(root, "archive/archive.json"), "utf8");
    expect(text).not.toContain("fixture-credential-must-not-transfer");
    expect(text).not.toContain("fixture-bearer-must-not-transfer");
    expect(
      createHash("sha256")
        .update(await readFile(file))
        .digest("hex"),
    ).toBe(before);
    const archive = JSON.parse(text);
    expect(archive.objects[0]).toMatchObject({
      last_modified: "Wed, 01 Jan 2020 00:00:00 GMT",
      mtime_ns: "1577836800000000000",
      content_type: "text/plain; charset=utf-8",
      etag:
        '"' +
        createHash("md5").update(`1577836800.0-${bytes.length}`).digest("hex") +
        '"',
    });
    const target = new DatabaseSync(":memory:");
    target.exec("PRAGMA foreign_keys=ON");
    const community = createCommunity({
      all(sql, ...values) {
        if (!values.length && sql.includes(";")) {
          target.exec(sql);
          return [];
        }
        const statement = target.prepare(sql);
        return statement.columns().length
          ? statement.all(...values)
          : (statement.run(...values), []);
      },
      transaction(operation) {
        target.exec("BEGIN");
        try {
          const value = operation();
          target.exec("COMMIT");
          return value;
        } catch (error) {
          target.exec("ROLLBACK");
          throw error;
        }
      },
    });
    expect(community.restore(archive.tables, "original-archive").members).toBe(
      1,
    );
    expect(community.restore(archive.tables, "original-archive").members).toBe(
      1,
    );
    expect(
      community.resolveIdentity(
        "https://fixture.example",
        "exact-source-subject",
      ).id,
    ).toBe(41);
    expect(community.page(41, "hello.world", 41)).toMatchObject({
      id: 19,
      user_id: 41,
      content: "Original content",
      is_public: 0,
    });
    expect(community.media(41).items[0]).toMatchObject({
      id: 7,
      storage_path: "jane/photo.txt",
    });
    expect(target.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(result.legacyCredentialsIncluded).toBe(false);
    target.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
