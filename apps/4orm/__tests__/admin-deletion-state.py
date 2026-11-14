import hashlib
import json
import pathlib
import sqlite3
import sys


def readonly(path):
    db = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    return db


def active_database(name, output, oracle):
    if name == "oracle":
        return pathlib.Path(oracle) / "oracle.sqlite3"
    base = pathlib.Path(output) / "native"
    runtime = json.loads((base / "runtime.json").read_text())
    paths = set()
    for pid in runtime["pids"]:
        descriptors = pathlib.Path("/proc") / str(pid) / "fd"
        if not descriptors.exists():
            continue
        for descriptor in descriptors.iterdir():
            try:
                path = descriptor.resolve()
                if path.name == "db.sqlite" and path.is_relative_to(base / "replica"):
                    paths.add(path)
            except OSError:
                pass
    assert len(paths) == 1, "Ambiguous native database"
    return paths.pop()


mode = sys.argv[1]
if mode == "plan":
    baseline, actor, oracle = pathlib.Path(sys.argv[2]), int(sys.argv[3]), pathlib.Path(sys.argv[4])
    db = readonly(baseline)
    users = [dict(row) for row in db.execute("SELECT id,username,is_admin,invited_by_user_id FROM users ORDER BY id")]
    media = [dict(row) for row in db.execute("SELECT id,user_id,storage_path,size_bytes FROM media ORDER BY id")]

    def descendants(root):
        ids = {root}
        while True:
            added = {u["id"] for u in users if u["invited_by_user_id"] in ids}
            if added <= ids:
                return ids
            ids |= added

    parents = [u for u in users if not u["is_admin"] and any(c["invited_by_user_id"] == u["id"] for c in users)]
    options = []
    for parent in parents:
        for prune in parents:
            subtree = descendants(prune["id"])
            if parent["id"] == prune["id"] or actor in subtree or parent["id"] in subtree:
                continue
            deleted = subtree | {parent["id"]}
            if not any(m["user_id"] == parent["id"] for m in media) or not any(m["user_id"] in subtree for m in media):
                continue
            cost = sum(m["size_bytes"] for m in media if m["user_id"] in deleted)
            options.append((cost, parent["id"], prune["id"], sorted(subtree)))
    assert options, "No safe real-cohort deletion pair"
    _, parent_id, prune_id, subtree = min(options)
    parent = next(u for u in users if u["id"] == parent_id)
    deleted = set(subtree) | {parent_id}
    expected = []
    for user in users:
        if user["id"] in deleted:
            continue
        inviter = user["invited_by_user_id"]
        if inviter == parent_id:
            inviter = parent["invited_by_user_id"]
        if inviter in subtree:
            inviter = None
        expected.append({"id": user["id"], "invited_by_user_id": inviter})
    uploads = pathlib.Path(json.loads((oracle / "runtime.json").read_text())["uploads"])
    for item in media:
        item["sha256"] = hashlib.sha256((uploads / item["storage_path"]).read_bytes()).hexdigest()
    print(json.dumps({"cases": [{"id": parent_id, "mode": "reparent", "count": 1}, {"id": prune_id, "mode": "prune", "count": len(subtree)}], "deleted": sorted(deleted), "expectedUsers": expected, "media": media}))
elif mode == "snapshot":
    name, output, oracle = sys.argv[2:5]
    context = json.load(sys.stdin)
    db = readonly(active_database(name, output, oracle))
    assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert not db.execute("PRAGMA foreign_key_check").fetchall()
    available = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    digests = {}
    for table in context["tables"]:
        assert table.isidentifier() and table in available
        rows = []
        for record in db.execute(f'SELECT * FROM "{table}"'):
            row = dict(record)
            if table == "external_identities" and row["user_id"] == context["auth"]["userId"] and row["issuer"] == context["auth"]["issuer"] and row["subject"] == context["auth"]["subject"]:
                continue
            if table == "users" and row["id"] == context["auth"]["userId"]:
                row.pop("updated_at", None)
            if table == "pages" and "page_content_chunks" in available:
                chunks = db.execute("SELECT content FROM page_content_chunks WHERE page_id=? ORDER BY position", (row["id"],)).fetchall()
                if chunks:
                    row["content"] = "".join(c[0] for c in chunks)
            rows.append(json.dumps(row, sort_keys=True, separators=(",", ":"), ensure_ascii=False))
        encoded = "\n".join(sorted(rows)).encode()
        digests[table] = {"count": len(rows), "sha256": hashlib.sha256(encoded).hexdigest()}
    pending = db.execute("SELECT count(*) FROM account_cleanup_objects").fetchone()[0] if "account_cleanup_objects" in available else 0
    print(json.dumps({"tables": digests, "users": [dict(r) for r in db.execute("SELECT id,invited_by_user_id FROM users ORDER BY id")], "pendingObjects": pending, "counters": [dict(r) for r in db.execute("SELECT * FROM visitor_counters ORDER BY user_id")], "integrity": True, "foreignKeys": True}))
else:
    raise ValueError("Unknown mode")
