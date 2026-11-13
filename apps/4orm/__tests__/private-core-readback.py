"""Compare imported content after local-copy browser workflows, without exposing values."""

import argparse
import json
import os
import sqlite3
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path

TABLES = (
    "site_settings",
    "users",
    "external_identities",
    "chat_messages",
    "forum_threads",
    "forum_posts",
    "guestbook_entries",
    "invites",
    "media",
    "pages",
    "profile_cards",
    "playlist_items",
    "thread_watchers",
)


def readonly(path: Path):
    db = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert not db.execute("PRAGMA foreign_key_check").fetchall()
    assert (
        db.execute("SELECT count(*) FROM users WHERE password_hash!=''").fetchone()[0]
        == 0
    )
    return db


def rows(db, table, columns, actor_id, native):
    result = [
        dict(row) for row in db.execute(f'SELECT {",".join(columns)} FROM "{table}"')
    ]
    for row in result:
        if table == "users" and row["id"] == actor_id:
            row.pop("updated_at", None)
        if table == "pages" and native:
            chunks = db.execute(
                "SELECT content FROM page_content_chunks WHERE page_id=? ORDER BY position",
                (row["id"],),
            ).fetchall()
            if chunks:
                row["content"] = "".join(part[0] for part in chunks)
    primary = [
        entry["name"]
        for entry in sorted(
            db.execute(f'PRAGMA table_info("{table}")'), key=lambda entry: entry["pk"]
        )
        if entry["pk"]
    ]
    return sorted(
        result,
        key=lambda row: json.dumps(
            [row.get(name) for name in primary or columns], sort_keys=True
        ),
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("baseline", type=Path)
    parser.add_argument("native", type=Path)
    parser.add_argument("receipt", type=Path)
    parser.add_argument("--review-actor", required=True, type=int)
    args = parser.parse_args()
    os.umask(0o077)
    results = []
    with (
        closing(readonly(args.baseline)) as source,
        closing(readonly(args.native)) as native,
    ):
        for table in TABLES:
            columns = [
                row["name"] for row in source.execute(f'PRAGMA table_info("{table}")')
            ]
            before = rows(source, table, columns, args.review_actor, False)
            after = rows(native, table, columns, args.review_actor, True)
            different = (
                [
                    name
                    for name in columns
                    if any(
                        a.get(name) != b.get(name)
                        for a, b in zip(before, after, strict=True)
                    )
                ]
                if len(before) == len(after)
                else ["row count"]
            )
            results.append(
                {
                    "table": table,
                    "baselineRows": len(before),
                    "nativeRows": len(after),
                    "equal": before == after,
                    "differingColumns": different,
                }
            )
    report = {
        "status": "PASS" if all(item["equal"] for item in results) else "FAIL",
        "checkedAt": datetime.now(UTC).isoformat(),
        "scope": "Imported core content subset; not excluded historical source tables",
        "exclusions": [
            "updated_at on the one review actor after controlled saves",
            "browser sessions, login transactions and app auxiliary records",
            "visitor counters, which browsing mutates",
        ],
        "tables": results,
        "productionTouched": False,
    }
    with args.receipt.open("x") as file:
        json.dump(report, file, indent=2)
        file.write("\n")
    print(json.dumps({"status": report["status"], "tables": len(results)}))
    return 0 if report["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
