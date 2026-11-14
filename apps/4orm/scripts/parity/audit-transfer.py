"""Audit private review authorities without changing them or reporting row values."""

import argparse
import collections
import hashlib
import http.client
import json
import os
import re
import sqlite3
import urllib.parse
import urllib.request
from pathlib import Path

os.umask(0o077)
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("root", type=Path)
parser.add_argument("native", type=Path)
parser.add_argument("output", type=Path)
parser.add_argument("--http", action="store_true")
parser.add_argument("--oracle", type=Path)
parser.add_argument("--fixture-auth", type=Path)
parser.add_argument("--oracle-origin", default="http://127.0.0.1:18964")
parser.add_argument("--native-origin", default="http://127.0.0.1:18974")
args = parser.parse_args()
oracle = args.oracle or args.root / "python-oracle"
assert oracle.resolve().is_relative_to(args.root.resolve()), (
    "Oracle must be private review state"
)
for origin in [args.oracle_origin, args.native_origin]:
    parsed = urllib.parse.urlsplit(origin)
    assert (
        parsed.scheme == "http"
        and parsed.hostname in {"localhost", "127.0.0.1", "::1"}
        and not parsed.username
        and not parsed.password
        and not parsed.query
        and not parsed.fragment
        and parsed.path in {"", "/"}
    ), "HTTP audit is restricted to exact loopback origins"

args.output.mkdir(mode=0o700, parents=True, exist_ok=False)


def readonly(path):
    db = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    db.execute("BEGIN")
    return db


def tables(db):
    return {
        row[0]
        for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")
    }


core = re.findall(
    r"CREATE TABLE IF NOT EXISTS (\w+)",
    (Path(__file__).resolve().parents[2] / "app/data/schema.ts").read_text(),
)
assert len(core) == 18 and len(set(core)) == 18
runtime = json.loads((args.native / "runtime.json").read_text())
paths = set()
for pid in runtime["pids"]:
    descriptors = Path("/proc") / str(pid) / "fd"
    if not descriptors.exists():
        continue
    for descriptor in descriptors.iterdir():
        try:
            path = descriptor.resolve()
            if path.name == "db.sqlite" and path.is_relative_to(
                args.native / "replica"
            ):
                with readonly(path) as probe:
                    if set(core) <= tables(probe):
                        paths.add(path)
        except (OSError, sqlite3.Error):
            continue
assert len(paths) == 1, "Ambiguous native community database"
cohort = args.root / "parity-cohort-metadata-20261112"
auth = json.loads(
    (
        args.fixture_auth or args.root / "parity-cohort-20261112/review-auth.json"
    ).read_text()
)
assert auth["reviewOnly"] and not auth["genuineProductionSso"]
assert urllib.parse.urlsplit(auth["issuer"]).hostname in {"127.0.0.1", "localhost"}, (
    "Fixture identity must belong to the private loopback issuer"
)
databases = {
    "correctedCohort": readonly(cohort / "cohort.sqlite3"),
    "oracle": readonly(oracle / "oracle.sqlite3"),
    "native": readonly(paths.pop()),
}
report = {
    "scope": "read-only corrected-cohort transfer audit; no row values or credential keys exported",
    "coreTables": len(core),
    "authorities": {},
    "comparisons": {},
    "normalizations": [
        "Isolated invite code values excluded, not imported or printed",
        "Only the exact approved fixture issuer+subject+local-user link excluded",
        "Selected fixture account updated_at ignored only in secondary comparison",
        "Native physical page chunks reassembled before logical comparison",
        "Push subscription keys never read; counts only",
    ],
    "productionTouched": False,
    "authorityWrites": False,
}


def rows(db, table):
    if table == "push_subscriptions":
        return []
    result = [dict(row) for row in db.execute(f'SELECT * FROM "{table}"')]
    if table == "pages" and "page_content_chunks" in tables(db):
        for row in result:
            chunks = db.execute(
                "SELECT content FROM page_content_chunks WHERE page_id=? ORDER BY position",
                (row["id"],),
            ).fetchall()
            if chunks:
                row["content"] = "".join(chunk[0] for chunk in chunks)
    if table == "invites":
        for row in result:
            row.pop("code", None)
    if table == "external_identities":
        result = [
            row
            for row in result
            if not (
                row["user_id"] == auth["userId"]
                and row["issuer"] == auth["issuer"]
                and row["subject"] == auth["subject"]
            )
        ]
    return result


def compare(expected, actual, keys):
    def index(records):
        return {
            json.dumps([row.get(key) for key in keys], sort_keys=True): row
            for row in records
        }

    a, b = index(expected), index(actual)
    assert len(a) == len(expected) and len(b) == len(actual), (
        "Ambiguous content row identity"
    )
    fields = collections.Counter()
    changed = 0
    for key in a.keys() & b.keys():
        different = [
            field
            for field in a[key].keys() | b[key].keys()
            if a[key].get(field) != b[key].get(field)
        ]
        changed += bool(different)
        fields.update(different)
    return {
        "missingRows": len(a.keys() - b.keys()),
        "additionalRows": len(b.keys() - a.keys()),
        "changedRows": changed,
        "changedColumns": dict(sorted(fields.items())),
        "equal": a == b,
    }


try:
    contents = {}
    for name, db in databases.items():
        assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert not db.execute("PRAGMA foreign_key_check").fetchall()
        assert (
            db.execute("SELECT count(*) FROM users WHERE password_hash!=''").fetchone()[
                0
            ]
            == 0
        ), "Unexpected local password data; audit stopped"
        available = tables(db)
        assert set(core) <= available, "Missing core content table"
        counts = {
            table: db.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0]
            for table in core
        }
        fixture_links = db.execute(
            "SELECT count(*) FROM external_identities WHERE user_id=? AND issuer=? AND subject=?",
            (auth["userId"], auth["issuer"], auth["subject"]),
        ).fetchone()[0]
        report["authorities"][name] = {
            "counts": counts,
            "fixtureLinks": fixture_links,
            "integrity": "ok",
            "foreignKeys": "ok",
            "operationalCounts": {
                table: db.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0]
                for table in sorted(available - set(core))
                if not table.startswith("sqlite_")
            },
        }
        contents[name] = {table: rows(db, table) for table in core}
    baseline = databases["correctedCohort"]
    for name in ["oracle", "native"]:
        comparison = {}
        for table in core:
            columns = [
                row[1] for row in baseline.execute(f'PRAGMA table_info("{table}")')
            ]
            actual_columns = [
                row[1]
                for row in databases[name].execute(f'PRAGMA table_info("{table}")')
            ]
            if table == "push_subscriptions":
                comparison[table] = {
                    "equal": report["authorities"][name]["counts"][table]
                    == report["authorities"]["correctedCohort"]["counts"][table]
                    == 0,
                    "policy": "excluded subscription keys; counts only",
                }
                continue
            keys = [
                row[1]
                for row in sorted(
                    baseline.execute(f'PRAGMA table_info("{table}")').fetchall(),
                    key=lambda row: row[5],
                )
                if row[5]
            ]
            assert keys and not (table == "invites" and "code" in keys)
            result = compare(
                contents["correctedCohort"][table], contents[name][table], keys
            )
            result["missingColumns"] = sorted(set(columns) - set(actual_columns))
            result["additionalColumns"] = sorted(set(actual_columns) - set(columns))
            expected, actual = contents["correctedCohort"][table], contents[name][table]
            if table == "users":

                def normalized(records):
                    return [
                        {
                            key: value
                            for key, value in row.items()
                            if not (row["id"] == auth["userId"] and key == "updated_at")
                        }
                        for row in records
                    ]

                result["fixtureTimestampNormalizedEqual"] = compare(
                    normalized(expected), normalized(actual), keys
                )["equal"]
            comparison[table] = result
        report["comparisons"][name] = comparison
    if args.http:
        inventory = json.loads((cohort / "inventory.json").read_text())
        report["mediaHTTP"] = {}
        source_runtime = json.loads((oracle / "runtime.json").read_text())
        uploads = Path(source_runtime["uploads"]).resolve()
        assert uploads.is_relative_to(oracle.resolve())
        mtime_exact = 0
        for asset in inventory["assets"]:
            path = (uploads / asset["path"]).resolve()
            assert path.is_relative_to(uploads)
            mtime_exact += str(path.stat().st_mtime_ns) == asset["mtime_ns"]
        report["sourcePhysicalMedia"] = {
            "files": len(inventory["assets"]),
            "mtimeNanosecondsExact": mtime_exact,
        }
        for name, origin in [
            ("oracle", args.oracle_origin.rstrip("/")),
            ("native", args.native_origin.rstrip("/")),
        ]:
            checks = collections.Counter()
            for asset in inventory["assets"]:
                assert ".." not in Path(asset["path"]).parts
                request = urllib.request.Request(
                    origin + "/uploads/" + urllib.parse.quote(asset["path"], safe="/"),
                    headers={"Accept-Encoding": "identity"},
                )
                try:
                    with urllib.request.urlopen(request, timeout=15) as response:
                        digest = hashlib.sha256()
                        size = 0
                        while chunk := response.read(1024 * 1024):
                            digest.update(chunk)
                            size += len(chunk)
                        checks["files"] += 1
                        checks["bytesExact"] += (
                            digest.hexdigest() == asset["sha256"]
                            and size == asset["bytes"]
                        )
                        checks["contentTypeExact"] += (
                            response.headers.get("Content-Type")
                            == asset["content_type"]
                        )
                        checks["etagExact"] += (
                            response.headers.get("ETag") == asset["etag"]
                        )
                        checks["lastModifiedExact"] += (
                            response.headers.get("Last-Modified")
                            == asset["last_modified"]
                        )
                except (OSError, ValueError, http.client.HTTPException) as error:
                    checks["errors"] += 1
                    checks["errorType_" + type(error).__name__] += 1
                if (checks["files"] + checks["errors"]) % 10 == 0:
                    (args.output / "progress.json").write_text(
                        json.dumps(
                            {
                                "phase": "media",
                                "authority": name,
                                "checked": checks["files"] + checks["errors"],
                            }
                        )
                        + "\n"
                    )
            report["mediaHTTP"][name] = dict(checks)
    differences = any(
        not check["equal"]
        for comparison in report["comparisons"].values()
        for check in comparison.values()
    )
    if args.http:
        differences |= any(
            checks.get("errors", 0)
            or any(
                checks.get(field, 0) != len(inventory["assets"])
                for field in [
                    "bytesExact",
                    "contentTypeExact",
                    "etagExact",
                    "lastModifiedExact",
                ]
            )
            for checks in report["mediaHTTP"].values()
        )
        differences |= mtime_exact != len(inventory["assets"])
    report["status"] = (
        "AUDIT_COMPLETE_DIFFERENCES_REQUIRE_RECONCILIATION"
        if differences
        else "AUDIT_COMPLETE_NO_CONTENT_DIFFERENCES"
    )
    (args.output / "receipt.json").write_text(json.dumps(report, indent=2) + "\n")
    (args.output / "progress.json").write_text(
        json.dumps({"phase": "complete", "status": report["status"]}) + "\n"
    )
    print(
        json.dumps(
            {
                "status": report["status"],
                "coreTables": len(core),
                "output": str(args.output),
            }
        )
    )
finally:
    for db in databases.values():
        db.close()
