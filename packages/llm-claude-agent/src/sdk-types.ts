/**
 * Structural types for the slice of `@anthropic-ai/claude-agent-sdk` this
 * driver consumes, mirrored from the SDK's own declarations at the PINNED
 * version (0.3.233 — see `peerDependencies`). Kept local because the SDK is
 * an OPTIONAL peer behind a lazy import: its ~300 MB platform binary must
 * never enter a default install, so its types cannot be a compile-time
 * dependency either. The capability preflight (session-driver.ts) is the
 * runtime guard against drift; when bumping the pinned version, re-verify
 * these shapes against the new declarations.
 */

import type { ZodRawShape } from 'zod';

// ---------------------------------------------------------------------------
// messages (subset of SDKMessage)
// ---------------------------------------------------------------------------

export interface SdkUserMessage {
  type: 'user';
  message: { role: 'user'; content: string };
  parent_tool_use_id: string | null;
  session_id?: string;
  [k: string]: unknown;
}

/** Anthropic per-call usage, as carried on an assistant `message.usage`. */
export interface SdkApiUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export type SdkAssistantContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: string; [k: string]: unknown };

export interface SdkAssistantMessage {
  type: 'assistant';
  /** One API assistant turn may arrive as SEVERAL of these sharing
   *  `message.id` (one per content block), each repeating the usage. */
  message: { id?: string; content: SdkAssistantContentBlock[]; usage?: SdkApiUsage };
  /** Non-null on subagent-originated messages — not this session's turns. */
  parent_tool_use_id: string | null;
  session_id: string;
  [k: string]: unknown;
}

export interface SdkSystemMessage {
  type: 'system';
  subtype: string; // 'init' + an open set of status subtypes
  session_id?: string;
  apiKeySource?: string;
  tools?: string[];
  mcp_servers?: Array<{ name: string; status: string }>;
  [k: string]: unknown;
}

export interface SdkResultSuccess {
  type: 'result';
  subtype: 'success';
  is_error: boolean;
  session_id: string;
  structured_output?: unknown;
  result?: string;
  total_cost_usd?: number;
  errors?: string[];
  [k: string]: unknown;
}

export interface SdkResultError {
  type: 'result';
  subtype:
    | 'error_during_execution'
    | 'error_max_turns'
    | 'error_max_budget_usd'
    | 'error_max_structured_output_retries';
  is_error: boolean;
  session_id: string;
  total_cost_usd?: number;
  errors?: string[];
  [k: string]: unknown;
}

export type SdkResultMessage = SdkResultSuccess | SdkResultError;

/** The open message union: knowns plus whatever a newer SDK emits. */
export type SdkMessage =
  | SdkUserMessage
  | SdkAssistantMessage
  | SdkSystemMessage
  | SdkResultMessage
  | { type: string; [k: string]: unknown };

// ---------------------------------------------------------------------------
// query + in-process MCP
// ---------------------------------------------------------------------------

export interface SdkQuery extends AsyncIterable<SdkMessage> {
  /** Streaming-input control: stop the in-flight episode. */
  interrupt(): Promise<unknown>;
}

/** MCP tool handler result (the MCP CallToolResult subset we produce). */
export interface SdkMcpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/** The query options this driver sets — names mirror SDK `Options`. */
export interface SdkQueryOptions {
  tools?: string[];
  disallowedTools?: string[];
  allowedTools?: string[];
  settingSources?: string[];
  systemPrompt?: string;
  env?: Record<string, string | undefined>;
  strictMcpConfig?: boolean;
  settings?: Record<string, unknown>;
  mcpServers?: Record<string, unknown>;
  permissionMode?: string;
  outputFormat?: { type: 'json_schema'; schema: unknown };
  model?: string;
  fallbackModel?: string;
  maxTurns?: number;
  pathToClaudeCodeExecutable?: string;
  cwd?: string;
  resume?: string;
  resumeSessionAt?: string;
  abortController?: AbortController;
  sessionStore?: SdkSessionStore;
  stderr?: (data: string) => void;
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// session-store mirror (SDK `Options.sessionStore`, alpha)
// ---------------------------------------------------------------------------

export interface SdkSessionKey {
  projectKey: string;
  sessionId: string;
  /** Set for subagent files; omitted for the main transcript. */
  subpath?: string;
}

export interface SdkSessionStoreEntry {
  type: string;
  uuid?: string;
  timestamp?: string;
  [k: string]: unknown;
}

export interface SdkSessionStore {
  append(key: SdkSessionKey, entries: SdkSessionStoreEntry[]): Promise<void>;
  load(key: SdkSessionKey): Promise<SdkSessionStoreEntry[] | null>;
}

// ---------------------------------------------------------------------------
// module surface
// ---------------------------------------------------------------------------

export interface SdkModule {
  query(params: { prompt: AsyncIterable<SdkUserMessage>; options?: SdkQueryOptions }): SdkQuery;
  tool(
    name: string,
    description: string,
    inputSchema: ZodRawShape,
    handler: (args: unknown, extra: unknown) => Promise<SdkMcpToolResult>,
  ): unknown;
  createSdkMcpServer(options: { name: string; version?: string; tools?: unknown[] }): unknown;
}
