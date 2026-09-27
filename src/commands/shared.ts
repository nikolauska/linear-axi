import { basename, resolve } from "node:path";
import { AxiError, notFound, operationError } from "../args.ts";
import { formatCommandArg } from "../lib/cli-helpers.ts";
import { sanitizeDocument } from "../lib/linear-format.ts";
import {
  asArray,
  callAvailableTool,
  callToolData,
  hasTool,
  isNotFoundToolError,
  isUnknownToolError,
  LinearToolError,
} from "../lib/mcp-tools.ts";
import { projectMatches } from "../lib/project-match.ts";
import { findGitRoot } from "../lib/repo-project.ts";
import type { Runtime } from "../types.ts";

export const DEFAULT_LIMIT = 50;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getIssueDetail(id, runtime) {
  return getDetailWithListFallback(runtime, {
    detailTool: "get_issue",
    detailArgs: { id },
    listTool: "list_issues",
    listArgs: { query: id, limit: 10 },
    identityFields: ["identifier", "id", "title"],
    matches: (issue) => issue.id === id || issue.identifier === id,
  });
}

export async function ensureIssueExists(id, runtime) {
  return requireExistingDetail(getIssueDetail(id, runtime), "issue", id, [
    `Run \`linear-axi issues list --all-projects --query ${formatCommandArg(id)}\` to search for the issue`,
  ]);
}

export async function findExistingIssue(title, team, runtime) {
  return findNamedResource(runtime, {
    listTool: "list_issues",
    listArgs: { query: title, team, limit: 10 },
    query: title,
    team,
    name: (issue) => issue.title,
  });
}

export async function getProjectDetail(id, runtime) {
  return getDetailWithListFallback(runtime, {
    detailTool: "get_project",
    detailArgs: { query: id },
    listTool: "list_projects",
    listArgs: { query: id, limit: 10 },
    identityFields: ["id", "slugId", "name"],
    requireKnownDetailTool: true,
    fallbackOnBlankDetail: true,
    detailMatches: (project) => projectMatches(project, id),
    matches: (project) => projectMatches(project, id),
  });
}

export async function ensureProjectExists(id, runtime) {
  return requireExistingDetail(getProjectDetail(id, runtime), "project", id, [
    `Run \`linear-axi projects list --query ${formatCommandArg(id)} --fields id,name,status\` to search for the project`,
  ]);
}

export async function findExistingProject(name, team, runtime) {
  return findNamedResource(runtime, {
    listTool: "list_projects",
    listArgs: { query: name, limit: 10 },
    query: name,
    team,
    name: (project) => project.name,
  });
}

export function projectSaveToolArgs(toolName, args) {
  if (toolName !== "save_project") return args;
  const { team, teamId, ...projectArgs } = args;
  const teamRef = teamId ?? team;
  if (teamRef === undefined) return projectArgs;
  return {
    ...projectArgs,
    [projectArgs.id ? "addTeams" : "setTeams"]: [teamRef],
  };
}

// Tool failures become errors that point at the lookup command for the rejected value, plus the
// command-specific recovery help that carries the caller's real ids.
export async function runMutation(runtime: Runtime, options) {
  let data;
  try {
    data = options.toolNames
      ? await callAvailableTool(runtime, options.toolNames, options.argsForTool ?? options.args)
      : await callToolData(runtime, options.tool, options.args);
  } catch (error) {
    if (error instanceof LinearToolError) {
      throw toolFailure(error, { team: options.team, help: options.help });
    }
    throw error;
  }
  // A save that returns only unparsed text has no record to confirm, so reporting success
  // would hide a failure that Linear did not flag with isError.
  if (
    data &&
    typeof data === "object" &&
    Object.keys(data).length === 1 &&
    typeof data.text === "string"
  ) {
    throw operationError(data.text.replace(/^Error:\s*/i, ""), options.help ?? []);
  }
  return options.render(data);
}

export function detailView(options) {
  if (options.full) return { [options.resource]: options.detail };
  const compact = options.compact(options.detail);
  return {
    [options.resource]: compact[options.resource],
    ...(compact.truncated
      ? { help: [`Run \`${options.fullCommand}\` to show the complete ${options.resource}`] }
      : {}),
  };
}

export async function getDocumentDetail(id, runtime) {
  return getDetailWithListFallback(runtime, {
    detailTool: "get_document",
    detailArgs: { id },
    listTool: "list_documents",
    listArgs: { query: id, limit: 10 },
    identityFields: ["id", "title", "name"],
    matches: (document) => document.id === id || document.slugId === id,
    transform: (document) => sanitizeDocument(document, id),
  });
}

export async function ensureDocumentExists(id, runtime) {
  return requireExistingDetail(getDocumentDetail(id, runtime), "document", id, [
    `Run \`linear-axi documents list --all-projects --query ${formatCommandArg(id)} --fields id,title,updatedAt\` to search for the document`,
  ]);
}

async function getDetailWithListFallback(runtime, options) {
  const knownToolNames = options.requireKnownDetailTool
    ? new Set(
        (typeof runtime.client.listTools === "function"
          ? await runtime.client.listTools()
          : []
        ).map((tool) => tool.name),
      )
    : null;
  const hasListTool = () =>
    knownToolNames ? knownToolNames.has(options.listTool) : hasTool(runtime, options.listTool);

  if (!options.requireKnownDetailTool || knownToolNames.has(options.detailTool)) {
    try {
      const data = options.requireKnownDetailTool
        ? await callToolData(runtime, options.detailTool, options.detailArgs)
        : await callAvailableTool(runtime, [options.detailTool], options.detailArgs);
      if (isBlankDetail(data, options.identityFields)) {
        if (!options.fallbackOnBlankDetail || !(await hasListTool())) return null;
      } else if (options.detailMatches && !options.detailMatches(data)) {
        if (!(await hasListTool())) return null;
      } else {
        return detailResult(data, options);
      }
    } catch (error) {
      if (isNotFoundToolError(error)) {
        if (!options.fallbackOnBlankDetail || !(await hasListTool())) return null;
      } else if (!isUnknownToolError(error)) {
        throw error;
      }
    }
  }

  const listed = await callToolData(runtime, options.listTool, options.listArgs);
  const match = asArray(listed).find(options.matches);
  if (!match) return null;
  return detailResult(match, options);
}

function detailResult(detail, options) {
  return options.transform ? options.transform(detail) : detail;
}

async function findNamedResource(runtime, options) {
  const listed = await callToolData(runtime, options.listTool, options.listArgs);
  return (
    asArray(listed).find(
      (item) => isSameText(options.name(item), options.query) && belongsToTeam(item, options.team),
    ) ?? null
  );
}

async function requireExistingDetail(detailPromise, resource, id, help) {
  const detail = await detailPromise;
  if (!detail) throw notFound(resource, id, help);
  return detail;
}

export async function ensureMilestoneExists(project, id, runtime) {
  const help = [
    `Run \`linear-axi milestones list --project ${formatCommandArg(project)}\` to find the milestone id`,
  ];
  let milestone;
  try {
    milestone = await callToolData(runtime, "get_milestone", { project, query: id });
  } catch (error) {
    if (isNotFoundToolError(error)) throw notFound("milestone", id, help);
    throw error;
  }
  if (!milestone || isEmptyContainer(milestone)) throw notFound("milestone", id, help);
  return milestone;
}

// list_cycles and list_documents only accept team ids, while users naturally pass a key or name.
export async function resolveTeamId(team, runtime) {
  if (UUID_PATTERN.test(team)) return team;
  let data;
  try {
    data = await callToolData(runtime, "get_team", { query: team });
  } catch (error) {
    if (!isNotFoundToolError(error)) throw error;
  }
  if (!data?.id) {
    throw notFound("team", team, ["Run `linear-axi teams list` to list teams"]);
  }
  return data.id;
}

// list_documents filters by project id or slug, but repo defaults and flags may hold a name.
export async function resolveProjectId(project, runtime) {
  const detail = await ensureProjectExists(project, runtime);
  return detail.id ?? detail.slugId ?? project;
}

export function normalizeError(error, runtime?: Pick<Runtime, "mcpUrl">) {
  if (error instanceof AxiError) return error;
  if (error?.authorizationUrl) {
    return operationError("Linear MCP OAuth authorization required", [
      "Run `linear-axi auth login`",
      "Run `linear-axi auth login --manual` if the browser cannot reach this machine",
    ]);
  }
  if (error instanceof LinearToolError) return toolFailure(error);
  const message = error instanceof Error ? error.message : String(error);
  if (/unauthorized|\b401\b|invalid_token|access token/i.test(message)) {
    return operationError("Linear MCP authentication failed", [
      "Run `linear-axi auth login` to authorize again",
      "Check LINEAR_AXI_MCP_TOKEN or LINEAR_MCP_TOKEN if a bearer token is configured",
    ]);
  }
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(message)) {
    const target = runtime?.mcpUrl ? ` at ${runtime.mcpUrl}` : "";
    return operationError(`Could not reach the Linear MCP server${target}`, [
      "Check network access and retry",
      "Set LINEAR_AXI_MCP_URL to use a different Linear MCP endpoint",
    ]);
  }
  return operationError(message, ["Run `linear-axi teams list` to verify Linear access"]);
}

export function toolFailure(
  error: LinearToolError,
  context: { team?: string; help?: string[] } = {},
) {
  return new AxiError(error.message, error.notFound ? "NOT_FOUND" : "OPERATION_ERROR", [
    ...lookupHints(error.message, context.team),
    ...(context.help ?? []),
  ]);
}

function lookupHints(message: string, team?: string) {
  const quoted = message.match(/"([^"]+)"/)?.[1];
  const value = quoted ? formatCommandArg(quoted) : '"<text>"';
  const teamArg = team ? formatCommandArg(team) : '"<team>"';
  if (/could not find (?:workflow )?state/i.test(message)) {
    return [`Run \`linear-axi statuses list --team ${teamArg}\` to list valid states`];
  }
  if (/could not find user/i.test(message)) {
    return [`Run \`linear-axi users list --query ${value}\` to find the user`];
  }
  if (/could not find label/i.test(message)) {
    return [`Run \`linear-axi labels list${team ? ` --team ${teamArg}` : ""}\` to list labels`];
  }
  if (/could not find team/i.test(message)) {
    return ["Run `linear-axi teams list` to list teams"];
  }
  if (/could not find project/i.test(message)) {
    return [`Run \`linear-axi projects list --query ${value}\` to find the project`];
  }
  if (/could not find cycle/i.test(message)) {
    return [`Run \`linear-axi cycles list --team ${teamArg}\` to list cycles`];
  }
  if (/could not find issue/i.test(message)) {
    return [`Run \`linear-axi issues list --all-projects --query ${value}\` to find the issue`];
  }
  return [];
}

export async function workspaceName(cwd) {
  const root = await findGitRoot(cwd);
  return basename(root ?? resolve(cwd));
}

function isSameText(left, right) {
  return (
    String(left ?? "")
      .trim()
      .toLocaleLowerCase() ===
    String(right ?? "")
      .trim()
      .toLocaleLowerCase()
  );
}

function isEmptyContainer(value) {
  return value && typeof value === "object" && Object.keys(value).length === 0;
}

function isBlankDetail(value, identityFields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return identityFields.every((field) => !hasText(value[field]));
}

function hasText(value) {
  return String(value ?? "").trim() !== "";
}

function belongsToTeam(item, team) {
  if (team === undefined || team === null || team === "") return true;
  const candidates = [
    item.team,
    item.team?.id,
    item.team?.key,
    item.team?.name,
    item.teamId,
    ...(Array.isArray(item.teams)
      ? item.teams.flatMap((entry) => [entry, entry?.id, entry?.key, entry?.name])
      : []),
  ];
  return candidates.some((candidate) => isSameText(candidate, team));
}
