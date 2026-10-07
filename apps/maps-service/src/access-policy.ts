import type { ProjectRole } from "./database.js";

export function canEditProject(
  role: ProjectRole | null,
): role is "owner" | "editor" {
  return role === "owner" || role === "editor";
}
