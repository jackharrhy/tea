import { parseGoldSrcSprite } from "@tea/maps-renderer/core";
import type { EditorSpriteMaterial } from "@tea/maps-editor/render";
import type { MapDirectoryHandle } from "./editor-project.ts";

async function directoryAt(
  root: MapDirectoryHandle,
  path: string,
): Promise<MapDirectoryHandle> {
  let current = root;
  for (const part of path.split("/")) {
    if (part && part !== ".") current = await current.getDirectoryHandle(part);
  }
  return current;
}

async function spriteFilesInDirectory(
  directory: MapDirectoryHandle,
  prefix: string,
): Promise<readonly { path: string; file: File }[]> {
  const files: { path: string; file: File }[] = [];
  for await (const [name, entry] of directory.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (entry.kind === "directory") {
      files.push(...(await spriteFilesInDirectory(entry, path)));
    } else if (name.toLowerCase().endsWith(".spr")) {
      files.push({ path, file: await entry.getFile() });
    }
  }
  return files.toSorted((left, right) => left.path.localeCompare(right.path));
}

export async function loadProjectSprites(
  handle: MapDirectoryHandle,
  roots: readonly string[],
): Promise<{
  sprites: readonly EditorSpriteMaterial[];
  diagnostics: readonly string[];
}> {
  const sprites: EditorSpriteMaterial[] = [];
  const diagnostics: string[] = [];
  for (const root of roots) {
    try {
      const prefix = root === "." ? "" : root;
      const directory = await directoryAt(handle, root);
      for (const { path, file } of await spriteFilesInDirectory(
        directory,
        prefix,
      )) {
        try {
          const sprite = parseGoldSrcSprite(await file.arrayBuffer());
          const frame = sprite.frames[0]?.frames[0];
          if (!frame) throw new Error("Sprite has no displayable frame");
          sprites.push({
            path,
            material: {
              name: `__tea_sprite__${path.toLowerCase()}`,
              sourceName: path,
              width: frame.width,
              height: frame.height,
              rgba: frame.rgba,
              alphaTest: true,
            },
          });
        } catch (error) {
          diagnostics.push(
            `${path}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    } catch (error) {
      diagnostics.push(
        `${root}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { sprites, diagnostics };
}
