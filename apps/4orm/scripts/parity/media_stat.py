"""Read source-compatible file metadata using the captured production MIME registry."""

import hashlib
import json
import mimetypes
import stat
import sys
from email.utils import formatdate
from pathlib import Path

registry = json.loads(
    (Path(__file__).resolve().parents[2] / "app/data/media-registry.json").read_text()
)
mime = mimetypes.MimeTypes()
mime.types_map[True].clear()
mime.types_map[True].update(registry["types"])
mime.suffix_map = registry["suffixes"]
mime.encodings_map = registry["encodings"]


def media_stat(path):
    info = Path(path).stat()
    if not stat.S_ISREG(info.st_mode):
        raise ValueError("Media must be a regular file")
    content_type = mime.guess_type(str(path))[0] or "application/octet-stream"
    if content_type.startswith("text/"):
        content_type += "; charset=utf-8"
    return {
        "size_bytes": info.st_size,
        "mtime_ns": str(info.st_mtime_ns),
        "last_modified": formatdate(info.st_mtime, usegmt=True),
        "etag": '"'
        + hashlib.md5(
            f"{info.st_mtime}-{info.st_size}".encode(), usedforsecurity=False
        ).hexdigest()
        + '"',
        "content_type": content_type,
    }


if __name__ == "__main__":
    print(json.dumps([media_stat(path) for path in json.load(sys.stdin)]))
