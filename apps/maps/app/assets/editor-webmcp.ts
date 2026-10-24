import { editEditorWebMcpTools } from "./editor-webmcp-edit.ts";
import { readEditorWebMcpTools } from "./editor-webmcp-read.ts";
import { documentEditorWebMcpTools } from "./editor-webmcp-document.ts";
import type {
  EditorActions,
  EditorState,
  WebMcpModelContext,
  WebMcpTool,
} from "./editor-webmcp-contract.ts";

function editorWebMcpTools(
  state: () => EditorState,
  actions: EditorActions,
): readonly WebMcpTool[] {
  return [
    ...readEditorWebMcpTools(state),
    ...editEditorWebMcpTools(state, actions),
    ...documentEditorWebMcpTools(state, actions),
  ];
}

export async function registerEditorWebMcpTools(
  document: Document,
  state: () => EditorState,
  actions: EditorActions,
): Promise<void> {
  const root = document.documentElement;
  const modelContext = (
    document as Document & { readonly modelContext?: WebMcpModelContext }
  ).modelContext;
  if (!modelContext?.registerTool) {
    root.dataset.teaMapsSiteTools = "unsupported";
    return;
  }
  const controller = new AbortController();
  window.addEventListener("pagehide", () => controller.abort(), { once: true });
  const tools = editorWebMcpTools(state, actions);
  const registrations = await Promise.allSettled(
    tools.map(async (entry) =>
      modelContext.registerTool(entry, { signal: controller.signal }),
    ),
  );
  root.dataset.teaMapsSiteToolCount = String(
    registrations.filter((result) => result.status === "fulfilled").length,
  );
  root.dataset.teaMapsSiteTools = registrations.some(
    (result) => result.status === "rejected",
  )
    ? "error"
    : "ready";
}
