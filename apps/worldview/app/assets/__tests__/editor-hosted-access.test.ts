import { expect, it, vi } from "vitest";
import {
  listHostedAccess,
  removeHostedAccess,
  setHostedAccessRole,
} from "../editor-hosted-access.ts";

it("lists signed-in users and writes editor or viewer access through the project API", async () => {
  const requests: string[] = [];
  const fetcher = vi.fn<typeof fetch>(async (path, init) => {
    const endpoint = String(path);
    requests.push(`${init?.method ?? "GET"} ${endpoint}`);
    expect(init?.credentials).toBe("same-origin");
    if (init?.method === "PUT") {
      expect(JSON.parse(String(init.body))).toEqual({ role: "viewer" });
      return Response.json({ ok: true });
    }
    if (init?.method === "DELETE") return Response.json({ ok: true });
    return Response.json({
      users: [
        {
          id: "owner-1",
          username: "owner",
          displayName: "Owner",
          role: "owner",
        },
        {
          id: "user-2",
          username: "mapper",
          displayName: "Mapper",
          role: null,
        },
      ],
    });
  });

  expect(await listHostedAccess("project-1", fetcher)).toHaveLength(2);
  await setHostedAccessRole("project-1", "user-2", "viewer", fetcher);
  await removeHostedAccess("project-1", "user-2", fetcher);
  expect(requests).toEqual([
    "GET /api/projects/project-1/members",
    "PUT /api/projects/project-1/members/user-2",
    "DELETE /api/projects/project-1/members/user-2",
  ]);
});

it("surfaces service access denials without treating them as success", async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({ error: "Project owner access required" }, { status: 403 }),
  );
  await expect(listHostedAccess("project-1", fetcher)).rejects.toThrow(
    "Project owner access required",
  );
});
