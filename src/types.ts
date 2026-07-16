import type { Writable } from "node:stream";

export type InputRecord = Record<string, any>;
export type Renderable = string | InputRecord;

export interface ParsedFlags extends InputRecord {
  positionals: string[];
}

export interface ParseFlagOptions {
  array?: string[];
  boolean?: string[];
  example?: string;
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
  client: McpClientLike;
  mcpUrl: string;
  binPath?: string;
}

export interface MainContext {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdout: Pick<Writable, "write">;
  client?: McpClientLike;
}
