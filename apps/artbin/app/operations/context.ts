import type { User } from "#db";
import { OperationError } from "./errors.ts";

export interface OperationContext {
  user: User;
  channel: "admin" | "cli" | "mcp";
}

export function requireOperationAdmin(context: OperationContext): void {
  if (!context.user.isAdmin) {
    throw new OperationError("Administrator access required", "forbidden", 403);
  }
}
