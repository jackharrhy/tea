"""Issue a local-copy test session, never a production cookie or genuine SSO proof."""

import base64
import json
import sqlite3
import sys
import time
from pathlib import Path

from itsdangerous import TimestampSigner

root = Path(sys.argv[1]).resolve()
runtime = json.loads((root / "runtime.json").read_text())
assert runtime["origin"] == "http://127.0.0.1:18964"
assert runtime["productionTouched"] is False
assert root.name == "python-oracle"
user_id = int(sys.argv[2])
with sqlite3.connect((root / "oracle.sqlite3").as_uri() + "?mode=ro", uri=True) as db:
    assert db.execute(
        "SELECT id FROM users WHERE id=? AND is_disabled=0", (user_id,)
    ).fetchone()
session = {
    "user_id": user_id,
    "oidc_issuer": "https://127.0.0.1:18965",
    "oidc_expires_at": time.time() + 1800,
}
payload = base64.b64encode(json.dumps(session).encode())
sys.stdout.write(TimestampSigner((root / "secret").read_text()).sign(payload).decode())
