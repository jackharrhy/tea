import { createContextKey } from "remix/router";
import type { BoardCell } from "./board-cell.ts";
import type { DirectoryCell } from "./directory-cell.ts";

export interface AppRuntimeService {
  directory: DurableObjectStub<DirectoryCell>;
  board(id: string): DurableObjectStub<BoardCell>;
  media: R2Bucket;
}

export const AppRuntime = createContextKey<AppRuntimeService>();
export const Authenticated = createContextKey<boolean>();
export const CurrentSessionToken = createContextKey<string | null>();
export const AppPassword = createContextKey<string>();

export function createRuntime(env: Env): AppRuntimeService {
  return {
    directory: env.DIRECTORY.getByName("main"),
    board(id: string) {
      return env.BOARDS.getByName(id);
    },
    media: env.MEDIA,
  };
}
