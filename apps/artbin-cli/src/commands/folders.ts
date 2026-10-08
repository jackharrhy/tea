import * as p from "@clack/prompts";
import { getAuthenticatedClient } from "../lib/auth.ts";
import {
  formatFolderDetail,
  formatFolderPlan,
  formatFolderTable,
  formatFolderTree,
} from "../lib/folder-format.ts";
import type { ManageFolderInput, ManageFolderResponse } from "../lib/api.ts";

type PendingFolderMutation =
  | { operation: "rename"; slug: string; name: string }
  | { operation: "move"; slug: string; destinationSlug: string | null };

function positionals(args: Record<string, unknown>): string[] {
  return (args._ as string[]) ?? [];
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function requireAdmin(user: { isAdmin: boolean }): void {
  if (!user.isAdmin) {
    throw new Error("This command requires an artbin administrator account.");
  }
}

async function listFolders(args: Record<string, unknown>) {
  const { api } = await getAuthenticatedClient();
  const result = await api.listFolders({ includeSystem: !!args.all });

  if (args.json) {
    printJson(result);
    return;
  }
  console.log(
    args.tree
      ? formatFolderTree(result.folders)
      : formatFolderTable(result.folders),
  );
}

async function showFolder(args: Record<string, unknown>) {
  const slug = positionals(args)[2];
  if (!slug) throw new Error("Usage: artbin folders show <slug> [--json]");

  const { api } = await getAuthenticatedClient();
  const result = await api.getFolder(slug);

  if (args.json) {
    printJson(result);
    return;
  }
  console.log(formatFolderDetail(result.folder));
}

async function confirmMutation(
  args: Record<string, unknown>,
  preview: ManageFolderResponse,
): Promise<boolean> {
  if (preview.plan.noOp) return false;
  if (args.yes) return true;
  if (args.json) {
    throw new Error("Use --yes with --json when applying folder changes.");
  }

  console.log(formatFolderPlan(preview.plan));
  const confirmed = await p.confirm({
    message: "Apply this change?",
    initialValue: false,
  });
  return !p.isCancel(confirmed) && confirmed;
}

async function runMutation(
  args: Record<string, unknown>,
  input: PendingFolderMutation,
) {
  const { api, user } = await getAuthenticatedClient();
  requireAdmin(user);

  const preview = await api.manageFolder({
    ...input,
    execution: { mode: "plan" },
  } as ManageFolderInput);
  if (args["dry-run"] || preview.plan.noOp) {
    if (args.json) printJson(preview);
    else console.log(formatFolderPlan(preview.plan));
    return;
  }

  if (!(await confirmMutation(args, preview))) {
    p.log.info("No changes applied.");
    return;
  }

  const result = await api.manageFolder({
    ...input,
    execution: { mode: "apply", confirm: true },
  } as ManageFolderInput);
  if (args.json) printJson(result);
  else
    p.log.success(
      `${result.plan.operation === "rename" ? "Renamed" : "Moved"} folder to ${result.plan.to.slug}`,
    );
}

async function renameFolder(args: Record<string, unknown>) {
  const values = positionals(args);
  const slug = values[2];
  const name = values.slice(3).join(" ");
  if (!slug || !name) {
    throw new Error(
      "Usage: artbin folders rename <slug> <new-name> [--dry-run] [--yes] [--json]",
    );
  }

  await runMutation(args, { operation: "rename", slug, name });
}

async function moveFolder(args: Record<string, unknown>) {
  const slug = positionals(args)[2];
  const destination = typeof args.to === "string" ? args.to : null;
  if (!slug || destination === null) {
    throw new Error(
      "Usage: artbin folders move <slug> --to <destination-or-root> [--dry-run] [--yes] [--json]",
    );
  }

  await runMutation(args, {
    operation: "move",
    slug,
    destinationSlug:
      destination === "root" || destination === "/" ? null : destination,
  });
}

function printHelp(): void {
  console.log(`artbin folders - inspect and organize server folders

Usage:
  artbin folders list [--tree] [--all] [--json]
  artbin folders show <slug> [--json]
  artbin folders rename <slug> <new-name> [--dry-run] [--yes] [--json]
  artbin folders move <slug> --to <destination-or-root> [--dry-run] [--yes] [--json]

Only administrators can rename or move folders.`);
}

export async function folderCommands(args: Record<string, unknown>) {
  switch (positionals(args)[1]) {
    case "list":
      await listFolders(args);
      break;
    case "show":
      await showFolder(args);
      break;
    case "rename":
      await renameFolder(args);
      break;
    case "move":
      await moveFolder(args);
      break;
    default:
      printHelp();
  }
}
