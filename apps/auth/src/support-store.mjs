import { DatabaseSync } from "node:sqlite";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { chmodSync } from "node:fs";

export const supportHash = (value) =>
  createHash("sha256").update(value).digest("hex");
export const supportRandom = () => randomBytes(32).toString("base64url");
const fail = (status) =>
  Object.assign(new Error("Support request unavailable"), { status });

// Shares access.sqlite and its recovery boundary. Only ciphertext contains bearer material.
export function createSupportStore({ filename, key, now = Date.now }) {
  if (!Buffer.isBuffer(key) || key.length !== 32)
    throw Error("Support encryption key must be 32 bytes");
  const db = new DatabaseSync(filename);
  if (filename !== ":memory:") chmodSync(filename, 0o600);
  db.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS support_lifecycle(
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, state TEXT NOT NULL,
      expires INTEGER NOT NULL, body TEXT NOT NULL, updated INTEGER NOT NULL
    );`);
  function encrypt(id, value) {
    const nonce = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(Buffer.from(id));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value)),
      cipher.final(),
    ]);
    return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString(
      "base64",
    );
  }
  function unpack(row) {
    if (!row) return null;
    const bytes = Buffer.from(row.body, "base64"),
      decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(row.id));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return {
      ...row,
      body: JSON.parse(
        Buffer.concat([
          decipher.update(bytes.subarray(28)),
          decipher.final(),
        ]).toString(),
      ),
    };
  }
  function get(id) {
    return unpack(
      db.prepare("SELECT * FROM support_lifecycle WHERE id=?").get(id),
    );
  }
  function put(row) {
    db.prepare(
      "UPDATE support_lifecycle SET state=?,body=?,updated=? WHERE id=?",
    ).run(row.state, encrypt(row.id, row.body), now(), row.id);
    return row;
  }
  function transaction(callback) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = callback();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  // On restart an in-flight exchange has an unknown outcome and must never be replayed.
  db.prepare(
    "UPDATE support_lifecycle SET state='unknown' WHERE state='exchanging'",
  ).run();
  return {
    create(kind, body, lifetime, state = "pending") {
      const ref = supportRandom(),
        id = supportHash(ref),
        expires = now() + lifetime;
      db.prepare("INSERT INTO support_lifecycle VALUES(?,?,?,?,?,?)").run(
        id,
        kind,
        state,
        expires,
        encrypt(id, body),
        now(),
      );
      return { ref, row: get(id) };
    },
    transfer(ref, kind, body, lifetime, state = "pending") {
      return transaction(() => {
        const previous = get(supportHash(ref));
        if (
          !previous ||
          previous.state !== "proof" ||
          previous.expires <= now()
        )
          throw fail(409);
        const nextRef = supportRandom(),
          id = supportHash(nextRef),
          expires = now() + lifetime;
        db.prepare("INSERT INTO support_lifecycle VALUES(?,?,?,?,?,?)").run(
          id,
          kind,
          state,
          expires,
          encrypt(id, body),
          now(),
        );
        delete previous.body.actorToken;
        delete previous.body.targetToken;
        delete previous.body.identityToken;
        previous.state = "used";
        put(previous);
        return { ref: nextRef, row: get(id) };
      });
    },
    get(ref) {
      return get(supportHash(ref));
    },
    update(ref, callback) {
      return transaction(() => {
        const row = get(supportHash(ref));
        if (!row) throw fail(410);
        callback(row);
        return put(row);
      });
    },
    retain(ref, material) {
      return transaction(() => {
        const row = get(supportHash(ref));
        if (!row || row.state === "used") throw fail(409);
        row.body = { ...row.body, ...material };
        // A native response can arrive after cleanup. Reopen cleanup, never the login.
        if (row.state === "cleaned") row.state = "ended";
        return put(row);
      });
    },
    prove(ref, material) {
      return transaction(() => {
        const row = get(supportHash(ref));
        if (!row || row.state !== "exchanging" || row.expires <= now())
          throw fail(409);
        row.body = { ...row.body, ...material };
        row.state = "proof";
        return put(row);
      });
    },
    claim(ref, kind, state, next, validate = () => true) {
      return transaction(() => {
        const row = get(supportHash(ref));
        if (!row || row.kind !== kind || row.expires <= now()) throw fail(410);
        if (row.state !== state) throw fail(409);
        if (!validate(row.body)) throw fail(403);
        row.state = next;
        return put(row);
      });
    },
    async sweep(revoke, validate = async () => true) {
      const rows = db
        .prepare(
          "SELECT * FROM support_lifecycle WHERE state NOT IN ('cleaned','used')",
        )
        .all()
        .map(unpack);
      for (const snapshot of rows) {
        const eligible = await validate(snapshot.body).catch(() => false);
        const row = transaction(() => {
          const current = get(snapshot.id);
          if (!current || ["cleaned", "used"].includes(current.state))
            return null;
          if (
            current.state !== "unknown" &&
            current.state !== "ended" &&
            current.expires > now() &&
            eligible
          )
            return null;
          // Terminating an outstanding issuance must survive a crash before its response.
          current.state = ["unknown", "exchanging"].includes(current.state)
            ? "unknown"
            : "ended";
          return put(current);
        });
        if (!row) continue;
        for (const field of ["targetToken", "actorToken"]) {
          const current = get(row.id);
          const token = current?.body[field];
          if (!token || !["ended", "unknown"].includes(current.state)) continue;
          try {
            await revoke(token, field, current.body);
          } catch {
            continue;
          }
          transaction(() => {
            const latest = get(row.id);
            if (
              latest &&
              ["ended", "unknown"].includes(latest.state) &&
              latest.body[field] === token
            ) {
              delete latest.body[field];
              put(latest);
            }
          });
        }
        transaction(() => {
          const latest = get(row.id);
          if (
            latest?.state === "ended" &&
            !latest.body.targetToken &&
            !latest.body.actorToken
          ) {
            latest.state = "cleaned";
            delete latest.body.identityToken;
            put(latest);
          }
        });
      }
    },
    unknownCount() {
      return db
        .prepare(
          "SELECT count(*) AS n FROM support_lifecycle WHERE state='unknown'",
        )
        .get().n;
    },
    close() {
      db.close();
    },
  };
}
