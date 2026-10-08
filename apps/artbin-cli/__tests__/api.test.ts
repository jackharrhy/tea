import { afterEach, describe, expect, test, vi } from "vitest";
import { ApiClient } from "../src/lib/api.ts";

const config = {
  serverUrl: "https://artbin.example/",
  sessionId: "session-123",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ApiClient folder operations", () => {
  test("follows every folder page so later top-level destinations are available", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          folders: [{ slug: "a/deep/path" }],
          nextCursor: "a/deep/path",
        }),
      )
      .mockResolvedValueOnce(Response.json({ folders: [{ slug: "z-root" }] }));
    vi.stubGlobal("fetch", fetchMock);
    expect(
      (await new ApiClient(config).listFolders()).folders.map(
        (folder) => folder.slug,
      ),
    ).toEqual(["a/deep/path", "z-root"]);
    expect(fetchMock.mock.calls[1][0].searchParams.get("cursor")).toBe(
      "a/deep/path",
    );
  });

  test("creates large folder lists in ordered batches within the server limit", async () => {
    const sizes: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, request) => {
        const { folders } = JSON.parse(request.body);
        sizes.push(folders.length);
        return Response.json({ created: folders, existing: [] });
      }),
    );
    const folders = Array.from({ length: 201 }, (_, index) => ({
      slug: `folder-${index}`,
      name: `Folder ${index}`,
    }));
    const result = await new ApiClient(config).createFolders(folders);
    expect(sizes).toEqual([100, 100, 1]);
    expect(result.created).toEqual(folders);
  });

  test("lists folders with the authenticated session", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        folders: [{ id: "one", slug: "maps", name: "Maps" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new ApiClient(config).listFolders({
      includeSystem: true,
    });

    expect(result.folders[0].slug).toBe("maps");
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://artbin.example/api/cli/folders?includeSystem=true"),
      { headers: { Cookie: "artbin_session=session-123" } },
    );
  });

  test("requests one folder by slug", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ folder: { slug: "maps/tower" } }));
    vi.stubGlobal("fetch", fetchMock);

    await new ApiClient(config).getFolder("maps/tower");

    const [url] = fetchMock.mock.calls[0];
    expect(url.toString()).toBe(
      "https://artbin.example/api/cli/folders?slug=maps%2Ftower",
    );
  });

  test("sends dry-run folder mutations as JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        success: true,
        applied: false,
        plan: { operation: "rename" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await new ApiClient(config).manageFolder({
      operation: "rename",
      slug: "maps/tower",
      name: "Tower Maps",
      execution: { mode: "plan" },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://artbin.example/api/cli/folder/manage",
      {
        method: "POST",
        headers: {
          Cookie: "artbin_session=session-123",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          operation: "rename",
          slug: "maps/tower",
          name: "Tower Maps",
          execution: { mode: "plan" },
        }),
      },
    );
  });

  test("preserves nested slashes while encoding a download path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("zip data"));
    vi.stubGlobal("fetch", fetchMock);

    await new ApiClient(config).downloadFolder("maps/Tower files");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://artbin.example/api/folder/download/maps/Tower%20files",
      { headers: { Cookie: "artbin_session=session-123" } },
    );
  });
});
