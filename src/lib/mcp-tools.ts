import type { InputRecord, McpResult, Runtime } from "../types.ts";

const LIST_KEYS = [
  "issues",
  "projects",
  "teams",
  "users",
  "documents",
  "comments",
  "milestones",
  "cycles",
  "statuses",
  "labels",
  "nodes",
  "items",
  "data",
];

// Linear reports failed tool calls as normal results flagged with `isError`; keeping them as a
// distinct error type stops error payloads from being rendered as data with exit code 0.
export class LinearToolError extends Error {
  tool: string;
  notFound: boolean;

  constructor(tool: string, message: string) {
    super(message);
    this.tool = tool;
    this.notFound = /could not find|not found/i.test(message);
  }
}

export async function callToolData(runtime: Runtime, name: string, args: InputRecord) {
  const result: McpResult = await runtime.client.callTool(name, args);
  if (result?.isError) throw new LinearToolError(name, toolErrorMessage(result));
  return extractData(result);
}

export async function callAvailableTool(runtime: Runtime, candidates: string[], args) {
  const tools =
    typeof runtime.client.listTools === "function" ? await runtime.client.listTools() : [];
  const names = new Set(tools.map((tool) => tool.name));
  if (names.size > 0 && !candidates.some((candidate) => names.has(candidate))) {
    throw new ToolUnavailableError(candidates);
  }
  const preferred = candidates.find((candidate) => names.has(candidate)) ?? candidates[0];
  const argsFor = typeof args === "function" ? args : () => args;
  const orderedCandidates = [
    preferred,
    ...candidates.filter((candidate) => candidate !== preferred),
  ];
  let preferredError;
  for (const candidate of orderedCandidates) {
    try {
      return await callToolData(runtime, candidate, argsFor(candidate));
    } catch (error) {
      if (!isUnknownToolError(error)) throw error;
      preferredError ??= error;
    }
  }
  throw preferredError;
}

export function isUnknownToolError(error: unknown) {
  if (error instanceof ToolUnavailableError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /unknown tool|tool .*not found|method not found|not found.*tool/i.test(message);
}

export function isNotFoundToolError(error: unknown) {
  return error instanceof LinearToolError && error.notFound;
}

function extractData(result: McpResult) {
  if (result?.structuredContent !== undefined) return result.structuredContent;
  const text = result?.content?.find?.((item) => item.type === "text")?.text;
  if (text) {
    try {
      return JSON.parse(text);
    } catch {
      return { text };
    }
  }
  return result ?? {};
}

// Linear error text is written for MCP callers: it carries an "Error:" prefix, request ids, and
// advice about JSON argument shapes that does not apply to CLI flags.
function toolErrorMessage(result: McpResult) {
  const text = result?.content?.find?.((item) => item.type === "text")?.text?.trim() ?? "";
  let message = text;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.message === "string") {
      message =
        typeof parsed.status === "number"
          ? `${parsed.message} (HTTP ${parsed.status})`
          : parsed.message;
    }
  } catch {
    // Plain-text errors are the common case.
  }
  message = message
    .replace(/^Error:\s*/i, "")
    .replace(/^Input validation error: Invalid arguments for tool \S+:\s*/i, "Invalid arguments: ");
  // Lookup failures carry the MCP parameter name ("for addLabels") and JSON-shape advice after
  // the first sentence; the first clause is all a CLI caller can act on.
  const lookup = message.match(/^(Could not find \w+(?: \w+)? "[^"]*")/i);
  if (lookup) return lookup[1];
  const sentences = message
    .split(/(?<=\.)(?<!\b(?:e\.g|i\.e)\.)\s+/i)
    .filter((sentence) => !/\bJSON\b/.test(sentence));
  return sentences.join(" ").trim() || "Linear rejected the request";
}

export function asArray(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  for (const key of LIST_KEYS) {
    if (Array.isArray(data[key])) return data[key];
  }
  // Envelope keys vary by tool; wrapping an unknown object as a single row used to turn
  // error payloads and pagination envelopes into blank rows.
  return Object.values(data).find(Array.isArray) ?? [];
}

export async function hasTool(runtime: Runtime, name: string) {
  if (typeof runtime.client.listTools !== "function") return false;
  const tools = await runtime.client.listTools();
  return tools.some((tool) => tool.name === name);
}

class ToolUnavailableError extends Error {
  constructor(candidates: string[]) {
    super(`Linear MCP server does not expose ${candidates.join(" or ")}`);
  }
}
