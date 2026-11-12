import { describe, expect, it, vi } from "vitest";
import {
  isGenericSocialPreview,
  normalizeLinkUrl,
  normalizeXVideoUrl,
  previewLink,
} from "../link-preview.ts";
import { parseArchivedPreview } from "../archive.ts";

it("recognizes social landing-page metadata without discarding post metadata", () => {
  const preview = {
    url: "https://www.instagram.com/reel/example/",
    title: "Instagram",
    description: "",
    imageUrl: "https://instagram.example/logo.png",
    siteName: "Instagram",
  };
  expect(isGenericSocialPreview(preview)).toBe(true);
  expect(
    isGenericSocialPreview({
      ...preview,
      title: "clouder on Instagram: a new reel",
    }),
  ).toBe(false);
  expect(
    isGenericSocialPreview({
      ...preview,
      url: "https://x.com/artist/status/123",
      title: "X on X",
    }),
  ).toBe(true);
});

describe("X video previews", () => {
  const url = "https://x.com/re_skob/status/2120511820561576258";
  const poster =
    "https://pbs.twimg.com/amplify_video_thumb/2120511774440976384/img/1z5C06JhzNNg70mW.jpg";
  const video =
    "https://video.twimg.com/amplify_video/2120511774440976384/vid/avc1/640x360/xgGEMc6vwlKHG1bD.mp4?tag=29";

  it("keeps a playable MP4 separate from its poster through archive validation", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) =>
        String(input).startsWith("https://api.fxtwitter.com/")
          ? new Response(
              JSON.stringify({
                tweet: {
                  id: "2120511820561576258",
                  media: {
                    all: [
                      {
                        type: "video",
                        thumbnail_url: poster,
                        variants: [
                          {
                            url: "https://video.twimg.com/stream.m3u8",
                            bitrate: 0,
                            content_type: "application/x-mpegURL",
                          },
                          {
                            url: video,
                            bitrate: 832000,
                            content_type: "video/mp4",
                          },
                        ],
                      },
                    ],
                  },
                },
              }),
              { headers: { "Content-Type": "application/json" } },
            )
          : new Response(
              `<meta property="og:title" content="A video"><meta property="og:image" content="${poster}">`,
              {
                headers: { "Content-Type": "text/html" },
              },
            ),
      );
    try {
      const preview = await previewLink(url);
      expect(preview).toMatchObject({ url, imageUrl: poster, videoUrl: video });
      expect(
        parseArchivedPreview(preview, "00000000-0000-0000-0000-000000000001")
          ?.videoUrl,
      ).toBe(video);
    } finally {
      fetch.mockRestore();
    }
  });

  it("rejects non-MP4 and non-Twitter media hosts", () => {
    expect(normalizeXVideoUrl(video)).toBe(video);
    expect(normalizeXVideoUrl("https://example.com/video.mp4")).toBeNull();
    expect(
      normalizeXVideoUrl("https://video.twimg.com/stream.m3u8"),
    ).toBeNull();
  });
});

describe("link URL boundary", () => {
  it("keeps public web URLs and drops fragments", () => {
    expect(
      normalizeLinkUrl(" https://x.com/user/status/123?foo=1#reply "),
    ).toBe("https://x.com/user/status/123?foo=1");
  });

  it.each([
    "file:///etc/passwd",
    "javascript:alert(1)",
    "http://localhost/",
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://service.internal/",
    "http://example.com:8080/",
    "https://user:pass@example.com/",
  ])("rejects unsafe URL %s", (url) => {
    expect(normalizeLinkUrl(url)).toBeNull();
  });
});

describe("link preview redirects", () => {
  it("does not fetch a private redirect target", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: "http://127.0.0.1/" },
      }),
    );
    try {
      const preview = await previewLink("https://example.com/post");
      expect(preview).toMatchObject({
        url: "https://example.com/post",
        imageUrl: null,
      });
      expect(fetch.mock.calls.map(([url]) => url)).toEqual([
        "https://example.com/post",
      ]);
    } finally {
      fetch.mockRestore();
    }
  });

  it("uses the final public URL for a redirected image", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url) =>
        url === "https://example.com/post"
          ? new Response(null, {
              status: 302,
              headers: { Location: "https://cdn.example.com/image.png" },
            })
          : new Response(null, { headers: { "Content-Type": "image/png" } }),
      );
    try {
      const preview = await previewLink("https://example.com/post");
      expect(preview.imageUrl).toBe("https://cdn.example.com/image.png");
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      fetch.mockRestore();
    }
  });
});

describe("X photo previews", () => {
  const url = "https://x.com/HammyOrkestar/status/2120581190155403607/photo/2";
  const first = "https://pbs.twimg.com/media/first.jpg";
  const second = "https://pbs.twimg.com/media/second.jpg";

  it("uses the selected photo instead of the post's first Open Graph image", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) =>
        String(input).startsWith("https://api.fxtwitter.com/")
          ? new Response(
              JSON.stringify({
                tweet: {
                  id: "2120581190155403607",
                  media: {
                    all: [
                      { type: "photo", url: first },
                      { type: "photo", url: second },
                    ],
                  },
                },
              }),
              { headers: { "Content-Type": "application/json" } },
            )
          : new Response(
              `<meta property="og:title" content="A post"><meta property="og:image" content="${first}">`,
              { headers: { "Content-Type": "text/html" } },
            ),
      );
    try {
      expect(await previewLink(url)).toMatchObject({
        url,
        imageUrl: `${second}?name=large`,
      });
    } finally {
      fetch.mockRestore();
    }
  });

  it("does not display the first photo when the selected photo is unavailable", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) =>
        String(input).startsWith("https://api.fxtwitter.com/")
          ? new Response("{}", {
              headers: { "Content-Type": "application/json" },
            })
          : new Response(
              `<meta property="og:title" content="A post"><meta property="og:image" content="${first}">`,
              { headers: { "Content-Type": "text/html" } },
            ),
      );
    try {
      expect((await previewLink(url)).imageUrl).toBeNull();
    } finally {
      fetch.mockRestore();
    }
  });
});
