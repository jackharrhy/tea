/**
 * Public entry point for the MCP package: the tool and resource declaration trees, the
 * factories that type their implementations, the handler that serves them, and the errors a
 * handler throws to steer a result.
 */

export {
  contextFor,
  CurrentResource,
  CurrentTool,
  ResourceUri,
  ResourceVariables,
  ToolInput,
} from "./context.ts";
export type {
  AnyRequestContext,
  ResourceContext,
  ResourceVariableValues,
  ToolContext,
} from "./context.ts";
export {
  createForbiddenError,
  createInvalidArgumentsError,
  createToolError,
} from "./errors.ts";
export type {
  ForbiddenError,
  InvalidArgumentsError,
  ToolError,
} from "./errors.ts";
export { createHandler } from "./handler.ts";
export type { CacheScope, HandlerOptions, McpHandler } from "./handler.ts";
export { ErrorCode } from "./jsonrpc.ts";
export {
  LATEST_PROTOCOL_VERSION,
  MetaKey,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "./protocol.ts";
export type { ClientCapabilities, Implementation } from "./protocol.ts";
export {
  createResource,
  resource,
  resources,
  walkResources,
} from "./resources.ts";
export type {
  ReadResult,
  Resource,
  ResourceAction,
  ResourceContents,
  ResourceDeclaration,
  ResourceDescriptor,
  ResourceGroup,
  ResourceListing,
  Routable,
} from "./resources.ts";
export {
  createTool,
  createToolController,
  tool,
  tools,
  walk,
} from "./tools.ts";
export type {
  Action,
  ActionOrHandler,
  CallToolResult,
  Controller,
  InputOf,
  TextContent,
  Tool,
  ToolAnnotations,
  ToolDefinition,
  ToolDescriptor,
  ToolGroup,
  ToolHandler,
  ToolMiddleware,
  ToolSchema,
} from "./tools.ts";
export { validateArguments } from "./validate.ts";
