import { basename } from "path";
import { describe, expect, test } from "vitest";
import {
  getFolderPreviewPath,
  getFolderPreviewFullPath,
} from "#lib/folder-preview.server";

describe("getFolderPreviewPath", () => {
  test("returns a path under the folder slug", () => {
    const path = getFolderPreviewPath("texturetown");
    expect(path).toBe("texturetown/_folder-preview.png");
  });

  test("works with nested folder slugs", () => {
    const path = getFolderPreviewPath("texturetown/abstract-brown-and-grey");
    expect(path).toBe(
      "texturetown/abstract-brown-and-grey/_folder-preview.png",
    );
  });

  test("filename does not start with a dot (dotfiles are not served by static file servers)", () => {
    const path = getFolderPreviewPath("anything");
    const filename = basename(path);
    expect(filename[0]).not.toBe(".");
  });
});

describe("getFolderPreviewFullPath", () => {
  test("returns an absolute path ending with the preview filename", () => {
    const fullPath = getFolderPreviewFullPath("texturetown");
    expect(fullPath).toContain(
      "public/uploads/texturetown/_folder-preview.png",
    );
  });
});
