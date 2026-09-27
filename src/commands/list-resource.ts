import { parseFlags } from "../args.ts";
import {
  appendContinuationHelp,
  collectKnownArgs,
  commandLine,
  dispatchCommandGroup,
} from "../lib/cli-helpers.ts";
import {
  compactRows,
  fieldHint,
  missingFields,
  paginationInfo,
  parseFields,
  selectFields,
} from "../lib/linear-format.ts";
import { asArray, callToolData } from "../lib/mcp-tools.ts";
import { applyRepoProjectDefault } from "../lib/repo-project.ts";
import { groupHelp } from "./help.ts";
import { DEFAULT_LIMIT, resolveProjectId, resolveTeamId } from "./shared.ts";

// Flags mirror each Linear list tool's input schema; the tools reject unknown keys, so sharing
// one flag list across resources produced "Unrecognized key" failures.
export const LIST_SPECS = {
  issues: {
    tool: "list_issues",
    value: [
      "assignee",
      "createdAt",
      "cursor",
      "cycle",
      "delegate",
      "label",
      "limit",
      "orderBy",
      "parentId",
      "priority",
      "project",
      "query",
      "state",
      "team",
      "updatedAt",
    ],
    boolean: ["includeArchived"],
    projectScoped: true,
    createHint:
      'Run `linear-axi issues create --title "<title>" --team "<team>"` to create an issue',
  },
  projects: {
    tool: "list_projects",
    value: [
      "createdAt",
      "cursor",
      "limit",
      "member",
      "orderBy",
      "query",
      "state",
      "team",
      "updatedAt",
    ],
    boolean: ["includeArchived", "includeMembers", "includeMilestones"],
    createHint:
      'Run `linear-axi projects create --name "<name>" --team "<team>"` to create a project',
  },
  documents: {
    tool: "list_documents",
    value: ["createdAt", "cursor", "limit", "orderBy", "project", "query", "team", "updatedAt"],
    boolean: ["includeArchived"],
    projectScoped: true,
    createHint:
      'Run `linear-axi documents create --title "<title>" --team "<team>" --content-file <path>` to create a document',
  },
  teams: {
    tool: "list_teams",
    value: ["createdAt", "cursor", "limit", "orderBy", "query", "updatedAt"],
    boolean: ["includeArchived"],
  },
  users: {
    tool: "list_users",
    value: ["cursor", "limit", "orderBy", "query", "team"],
    boolean: [],
  },
  labels: {
    tool: "list_issue_labels",
    value: ["cursor", "limit", "name", "orderBy", "team"],
    boolean: ["includeArchived"],
  },
};

const FLAG_ARGS = {
  assignee: "<user>",
  createdAt: "<filter>",
  cursor: "<cursor>",
  cycle: "<cycle>",
  delegate: "<user>",
  label: "<label>",
  limit: `<n> default ${DEFAULT_LIMIT}`,
  member: "<user>",
  name: "<name>",
  orderBy: "createdAt|updatedAt",
  parentId: "<issue-id>",
  priority: "<0-4>",
  project: "<project>",
  query: "<text>",
  state: "<name-or-type>",
  team: "<team>",
  updatedAt: "<filter>",
};

// Help is generated from the same spec the parser uses, so documented flags are always accepted.
function listAliasHelp(publicName) {
  const spec = LIST_SPECS[publicName];
  const flags = [
    ...spec.value.map((name) => `  --${name} ${FLAG_ARGS[name] ?? "<value>"}`),
    ...spec.boolean.map((name) => `  --${name}`),
    ...(spec.projectScoped ? ["  --all-projects"] : []),
    "  --fields <comma-separated-fields>",
    "  --full",
  ];
  const note = spec.projectScoped
    ? `notes:
  ${publicName} list uses the repo default project from .linear-project unless --project or --all-projects is given.
`
    : "";
  return `usage: linear-axi ${publicName} list [filters] [--full]
flags:
${flags.join("\n")}
examples:
  linear-axi ${publicName} list ${spec.projectScoped ? "--all-projects " : ""}--limit 25
  linear-axi ${publicName} list --fields ${fieldHint(publicName)}
${note}`;
}

const PAGING_FLAGS = ["cursor", "limit", "fields", "full"];

export async function listResourceCommand(publicName, args, runtime) {
  return dispatchCommandGroup(args, {
    name: publicName,
    help: () => groupHelp(publicName, ["list"]),
    handlers: {
      list: (rest) => aliasListCommand(publicName, rest, runtime),
    },
    unknownHelp: [`Run \`linear-axi ${publicName} list\``],
  });
}

export async function aliasListCommand(publicName, args, runtime) {
  const spec = LIST_SPECS[publicName];
  const parsed = parseFlags(args, {
    command: `${publicName} list`,
    value: [...spec.value, "fields"],
    boolean: [...spec.boolean, "full", ...(spec.projectScoped ? ["all-projects"] : [])],
  });
  if (parsed.help) return listAliasHelp(publicName);

  const toolArgs = collectKnownArgs(parsed, [...spec.value, ...spec.boolean]);
  if (!("limit" in toolArgs)) toolArgs.limit = DEFAULT_LIMIT;
  if (spec.projectScoped) {
    await applyRepoProjectDefault(toolArgs, runtime, {
      allProjects: Boolean(parsed["all-projects"]),
      allProjectsCommand: `linear-axi ${publicName} list --all-projects`,
      command: `linear-axi ${publicName} list`,
      requireProject: true,
    });
  }
  if (publicName === "documents") await useDocumentFilterIds(toolArgs, runtime);

  const data = await callToolData(runtime, spec.tool, toolArgs);
  const dataRows = asArray(data);
  const fields = parsed.fields ? parseFields(parsed.fields) : null;
  const rows = parsed.full
    ? data
    : fields
      ? selectFields(dataRows, fields)
      : compactRows(publicName, data);
  const page = paginationInfo(data, dataRows.length);
  const allFlags = [...spec.value, ...spec.boolean, "fields", "full", "all-projects"];
  const help = listHints(publicName, spec, parsed, dataRows, fields);
  appendContinuationHelp(
    help,
    `linear-axi ${publicName} list`,
    parsed,
    allFlags.filter((name) => name !== "cursor"),
    page.cursor,
  );
  return {
    count: page.count,
    ...(page.cursor ? { cursor: page.cursor } : {}),
    [publicName]: rows,
    ...(help.length > 0 ? { help } : {}),
  };
}

// list_documents filters by projectId/teamId; names from flags or .linear-project are resolved.
async function useDocumentFilterIds(toolArgs, runtime) {
  const { project, team } = toolArgs;
  delete toolArgs.project;
  delete toolArgs.team;
  if (project !== undefined) toolArgs.projectId = await resolveProjectId(project, runtime);
  if (team !== undefined) toolArgs.teamId = await resolveTeamId(team, runtime);
}

function listHints(publicName, spec, parsed, rows, fields) {
  if (rows.length > 0) {
    const missing = fields ? missingFields(rows, fields) : [];
    if (missing.length === 0) return [];
    return [
      `Field not found in returned ${publicName}: ${missing.join(", ")}`,
      `Run \`${commandLine(`linear-axi ${publicName} list`, parsed, scopeFlags(spec), { full: true })}\` to see available fields`,
    ];
  }
  const hints = [];
  if (spec.projectScoped && !parsed["all-projects"]) {
    const flags = scopeFlags(spec).filter((name) => name !== "project");
    hints.push(
      `Run \`${commandLine(`linear-axi ${publicName} list`, parsed, flags, { "all-projects": true })}\` to search every project`,
    );
  }
  const searchFlag = ["query", "name"].find((name) => spec.value.includes(name));
  if (spec.createHint) hints.push(spec.createHint);
  else if (searchFlag && parsed[searchFlag] === undefined) {
    hints.push(
      `Run \`linear-axi ${publicName} list --${searchFlag} "<text>"\` to search ${publicName}`,
    );
  }
  return hints;
}

function scopeFlags(spec) {
  return [...spec.value, ...spec.boolean, "all-projects"].filter(
    (name) => !PAGING_FLAGS.includes(name),
  );
}
