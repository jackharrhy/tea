import { humanBytes } from "../app/media-view.tsx";
import { expect, test } from "vitest";
import { readMedia } from "../app/media.ts";
import { mediaRanges } from "../app/media-range.ts";

function fixture() {
  const content = new TextEncoder().encode("0123456789");
  const object = {
    size: content.length,
    etag: "example",
    httpEtag: '"example"',
    uploaded: new Date("2026-11-12T00:00:00Z"),
  };
  let reads = 0;
  const env = {
    MEDIA: {
      async head() {
        return object;
      },
      async get(_key, options) {
        reads++;
        expect(options.onlyIf.etagMatches).toBe("example");
        const range = options.range;
        const part = range
          ? content.slice(range.offset, range.offset + range.length)
          : content;
        return { ...object, body: new Response(part).body };
      },
    },
  };
  const store = {
    async call(operation, path) {
      expect(operation).toBe("publishedMedia");
      expect(path).toBe("member/audio.ogg");
      return { mime_type: "audio/ogg" };
    },
  };
  return {
    reads: () => reads,
    async request(headers = {}, method = "GET") {
      return readMedia(
        new Request("https://review.invalid/uploads/member/audio.ogg", {
          method,
          headers,
        }),
        env,
        store,
        "member/audio.ogg",
      );
    },
  };
}

test("media seeking returns exact bounded, suffix and multipart bytes", async () => {
  const f = fixture();
  let r = await f.request({ Range: "bytes=2-4" });
  expect(r.status).toBe(206);
  expect(r.headers.get("Content-Range")).toBe("bytes 2-4/10");
  expect(await r.text()).toBe("234");
  r = await f.request({ Range: "bytes=-3" });
  expect(await r.text()).toBe("789");
  r = await f.request({ Range: "bytes=0-1,8-9" });
  const body = await r.text();
  expect(r.status).toBe(206);
  expect(body).toContain("bytes 0-1/10\r\n\r\n01\r\n");
  expect(body).toContain("bytes 8-9/10\r\n\r\n89\r\n");
  expect(Number(r.headers.get("Content-Length"))).toBe(
    new TextEncoder().encode(body).length,
  );
});

test("HEAD and conditional requests do not open a media body; stale If-Range returns a full file", async () => {
  const f = fixture();
  let r = await f.request({ Range: "bytes=1-3" }, "HEAD");
  expect(r.status).toBe(206);
  expect(r.headers.get("Content-Length")).toBe("3");
  expect(await r.text()).toBe("");
  r = await f.request({ "If-None-Match": 'W/"example"' });
  expect(r.status).toBe(304);
  r = await f.request({ "If-Modified-Since": "Thu, 12 Nov 2026 00:00:00 GMT" });
  expect(r.status).toBe(304);
  expect(f.reads()).toBe(0);
  r = await f.request({ Range: "bytes=1-3", "If-Range": '"outdated"' });
  expect(r.status).toBe(200);
  expect(await r.text()).toBe("0123456789");
});

test("range validation matches source limits and merging without reading unrequested bytes", async () => {
  const f = fixture();
  const r = await f.request({ Range: "bytes=10-" });
  expect(r.status).toBe(416);
  expect(r.headers.get("Content-Range")).toBe("bytes */10");
  expect(f.reads()).toBe(0);
  expect((await f.request({ Range: "items=0-2" })).status).toBe(400);
  expect(mediaRanges("bytes=0-3,2-5,6-7", 10)).toEqual([{ start: 0, end: 8 }]);
  expect(mediaRanges("bytes=" + Array(101).fill("0-1").join(","), 10)).toEqual(
    [],
  );
});

test("media sizes keep the source's decimal half-even formatting", () => {
  expect([0, 1024, 1280, 1536, 1792, 2304].map(humanBytes)).toEqual([
    "0 B",
    "1.0 KB",
    "1.2 KB",
    "1.5 KB",
    "1.8 KB",
    "2.2 KB",
  ]);
});
