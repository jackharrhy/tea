"""Copy an existing consistent source backup into a private, credential-free cohort."""

import hashlib
import json
import os
import secrets
import shutil
import sqlite3
import sys
from pathlib import Path

os.umask(0o077)
source, target = map(Path, sys.argv[1:])
target.mkdir(mode=0o700)
src_path = source / "4orm.db"
source_hash = hashlib.sha256(src_path.read_bytes()).hexdigest()
src = sqlite3.connect(src_path.resolve().as_uri() + "?mode=ro", uri=True)
src.row_factory = sqlite3.Row
assert src.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
assert not src.execute("PRAGMA foreign_key_check").fetchall()
dst = sqlite3.connect(target / "cohort.sqlite3")
# Keep schema, but never copy historical issuer credentials, push subscriptions or live jobs.
kept = {
    "site_settings",
    "users",
    "chat_messages",
    "external_identities",
    "forum_threads",
    "guestbook_entries",
    "invites",
    "media",
    "pages",
    "profile_cards",
    "visitor_counters",
    "forum_posts",
    "playlist_items",
    "thread_watchers",
    "alembic_version",
}
schema = src.execute(
    "SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type DESC"
).fetchall()
for entry in schema:
    if entry["type"] == "table":
        dst.execute(entry["sql"])
counts = {}
for table in sorted(kept):
    rows = [dict(row) for row in src.execute(f'SELECT * FROM "{table}"')]
    for row in rows:
        if table == "users":
            row["password_hash"] = ""
        if table == "invites":
            row["code"] = secrets.token_urlsafe(24)
        columns = ",".join('"' + col + '"' for col in row)
        dst.execute(
            f'INSERT INTO "{table}" ({columns}) VALUES ({",".join("?" for _ in row)})',
            list(row.values()),
        )
    counts[table] = len(rows)
for entry in schema:
    if entry["type"] == "index":
        dst.execute(entry["sql"])
dst.commit()
assert dst.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
assert not dst.execute("PRAGMA foreign_key_check").fetchall()
assets = []
for row in dst.execute("SELECT storage_path,size_bytes FROM media ORDER BY id"):
    key, size = row
    path = source / "uploads" / key
    assert path.resolve().is_relative_to((source / "uploads").resolve())
    data = path.read_bytes()
    assert len(data) == size
    dest = target / "uploads" / key
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(path, dest)
    assert hashlib.sha256(dest.read_bytes()).digest() == hashlib.sha256(data).digest()
    assets.append(
        {"path": key, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    )
assert source_hash == hashlib.sha256(src_path.read_bytes()).hexdigest()
report = {
    "source": str(source),
    "sourceDatabaseSha256": source_hash,
    "counts": counts,
    "assets": assets,
    "exclusions": [
        "password hashes blanked",
        "invite codes replaced with isolated random codes",
        "OAuth and password reset rows excluded",
        "push subscriptions and all enrollment work excluded",
    ],
    "integrity": "ok",
    "foreignKeys": "ok",
}
(target / "inventory.json").write_text(json.dumps(report, indent=2) + "\n")
dst.close()
src.close()
print(
    json.dumps(
        {
            "tables": len(counts),
            "members": counts["users"],
            "media": len(assets),
            "bytes": sum(a["bytes"] for a in assets),
        }
    )
)
