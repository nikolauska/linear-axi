import type { Writable } from "node:stream";

export type InputRecord = Record<string, any>;
export type Renderable = string | InputRecord;

export interface ParsedFlags extends InputRecord {
  positionals: string[];
  // Kept on the parsed result so value validation can point at the right subcommand help.
  command: string;
}

export interface ParseFlagOptions {
  // Subcommand path such as "issues update"; used for unknown-flag errors and help hints.
  command: string;
  boolean?: string[];
  value?: string[];
  array?: string[];
  // Maximum positional arguments accepted; extra positionals are rejected instead of ignored.
  positionals?: number;
}

export interface McpClientLike {
  listTools(): Promise<Array<{ name: string }>>;
  callTool(name: string, args: InputRecord): Promise<any>;
  finishAuth?(code: string): Promise<void>;
  logoutAuth?(): Promise<{ removed: boolean; tokenConfigured: boolean }>;
  close?(): Promise<void>;
}

export interface McpTool {
  name: string;
}

export interface McpResult {
  structuredContent?: unknown;
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

export interface Runtime {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdout: Pick<Writable, "write">;
  stderr?: Pick<Writable, "write">;
  client: McpClientLike;
  mcpUrl: string;
  binPath?: string;
}

export interface MainContext {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdout: Pick<Writable, "write">;
  stderr?: Pick<Writable, "write">;
  client?: McpClientLike;
}
