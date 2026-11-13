import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import registry from "../app/data/media-registry.json" with { type: "json" };
import { mediaContentType, sourceMediaMetadata } from "../app/media-headers.ts";

test("native filename detection matches the production Python registry, including aliases and case-sensitive encodings", () => {
  const names = [
    ...Object.keys(registry.types).flatMap((ext) => [
      "file" + ext,
      "file" + ext.toUpperCase(),
    ]),
    ...Object.keys(registry.suffixes).map((ext) => "file" + ext),
    ".hidden",
    "directory.with.dots/file",
    "file.tar.gz",
    "file.svgz",
    "file.TAR.GZ",
    "file.unknown",
  ];
  const result = spawnSync(
    "python3",
    [
      "-c",
      `import sys,json,mimetypes
r=json.load(open(sys.argv[1]));m=mimetypes.MimeTypes();m.types_map[True].clear();m.types_map[True].update(r['types']);m.suffix_map=r['suffixes'];m.encodings_map=r['encodings']
def content_type(name):
 t=m.guess_type(name)[0] or 'application/octet-stream'
 return t+'; charset=utf-8' if t.startswith('text/') else t
print(json.dumps([content_type(n) for n in json.load(sys.stdin)]))`,
      fileURLToPath(
        new URL("../app/data/media-registry.json", import.meta.url),
      ),
    ],
    { input: JSON.stringify(names), encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(names.map(mediaContentType)).toEqual(JSON.parse(result.stdout));
});

test("archive stat metadata rejects unsafe headers and retains nanosecond timestamps without numeric rounding", () => {
  expect(
    sourceMediaMetadata({
      last_modified: "Thu, 12 Nov 2026 13:00:00 GMT",
      etag: '"abcd1234"',
      mtime_ns: "1794488400123456789",
    }),
  ).toEqual({
    fourm_last_modified: "Thu, 12 Nov 2026 13:00:00 GMT",
    fourm_etag: '"abcd1234"',
    fourm_mtime_ns: "1794488400123456789",
  });
  expect(() => sourceMediaMetadata({ etag: '"ok"\r\nInjected: yes' })).toThrow(
    "ETag",
  );
  expect(() => sourceMediaMetadata({ last_modified: "not a date" })).toThrow(
    "modification date",
  );
  expect(() =>
    sourceMediaMetadata({ mtime_ns: Number("1794488400123456789") }),
  ).toThrow("timestamp");
  expect(sourceMediaMetadata({})).toEqual({});
});
