import { commandHelp, parseFlags, usage } from "../args.ts";
import {
  applyTextFileFlag,
  collectKnownArgs,
  commandLine,
  dispatchCommandGroup,
  formatCommandArg,
  rejectIdOnCreate,
  requireValue,
} from "../lib/cli-helpers.ts";
import { compactIssueDetail, compactIssueMutation } from "../lib/linear-format.ts";
import { applyRepoProjectDefault } from "../lib/repo-project.ts";
import { groupHelp, issueCreateHelp, issueUpdateHelp, issueViewHelp } from "./help.ts";
import { aliasListCommand } from "./list-resource.ts";
import { detailView, ensureIssueExists, findExistingIssue, runMutation } from "./shared.ts";
import type { InputRecord } from "../types.ts";

const ISSUE_FIELDS = [
  "title",
  "team",
  "description",
  "state",
  "assignee",
  "project",
  "cycle",
  "parentId",
  "dueDate",
  "estimate",
  "priority",
];
const ISSUE_CREATE_HELP = [
  'Run `linear-axi issues create --title "<title>" --team "<team>"`',
  commandHelp("issues create"),
];
const ISSUE_UPDATE_HELP = [
  'Run `linear-axi issues update --id <id> --state "<state>"`',
  "Run `linear-axi issues list --all-projects --query <text>` to find the issue id",
];
const ISSUE_ID_ON_CREATE_HELP = [
  'Run `linear-axi issues create --title "<title>" --team "<team>"` to create a new issue',
  'Run `linear-axi issues update --id <id> --state "<state>"` to edit an existing issue',
];

export async function issueCommand(args, runtime) {
  return dispatchCommandGroup(args, {
    name: "issues",
    help: () => groupHelp("issues", ["list", "view", "create", "update"]),
    handlers: {
      list: (rest) => aliasListCommand("issues", rest, runtime),
      view: (rest) => viewIssueCommand(rest, runtime),
      create: (rest) => createIssueCommand(rest, runtime),
      update: (rest) => updateIssueCommand(rest, runtime),
    },
    unknownHelp: [
      "Run `linear-axi issues list`",
      "Run `linear-axi issues view <id>`",
      'Run `linear-axi issues update --id <id> --state "<state>"`',
    ],
  });
}

async function viewIssueCommand(args, runtime) {
  const parsed = parseFlags(args, { command: "issues view", boolean: ["full"], positionals: 1 });
  if (parsed.help) return issueViewHelp();
  const id = parsed.positionals[0];
  if (!id) throw usage("issue id is required", ["Run `linear-axi issues view <id>`"]);
  if (id === "all") {
    throw usage("issues view expects one issue id", [
      "Run `linear-axi issues list --limit 50` to view many issues",
      "Run `linear-axi issues view <id>` to view one issue",
    ]);
  }
  const detail = await ensureIssueExists(id, runtime);
  return detailView({
    resource: "issue",
    detail,
    full: parsed.full,
    compact: compactIssueDetail,
    fullCommand: `linear-axi issues view ${formatCommandArg(id)} --full`,
  });
}

async function createIssueCommand(args, runtime) {
  const parsed = parseFlags(args, {
    command: "issues create",
    value: [...ISSUE_FIELDS, "id", "description-file"],
    array: ["label"],
    boolean: ["allow-duplicate"],
  });
  if (parsed.help) return issueCreateHelp();
  rejectIdOnCreate("issue", ISSUE_ID_ON_CREATE_HELP, parsed);
  // Local validation runs before any Linear lookup so input mistakes fail fast and offline.
  requireValue(
    parsed.title && parsed.team,
    "creating an issue requires --title and --team",
    ISSUE_CREATE_HELP,
  );
  const toolArgs = collectKnownArgs(parsed, ISSUE_FIELDS);
  if (parsed.label) toolArgs.labels = parsed.label;
  await applyTextFileFlag(toolArgs, parsed, {
    flag: "description-file",
    field: "description",
    cwd: runtime.cwd,
  });
  await applyRepoProjectDefault(toolArgs, runtime, { command: "linear-axi issues create" });

  // Returning the existing issue makes a retry after a lost response safe; duplicates stay
  // possible, but only when asked for explicitly.
  if (!parsed["allow-duplicate"]) {
    const existing = await findExistingIssue(toolArgs.title, toolArgs.team, runtime);
    if (existing) {
      return {
        issue: compactIssueMutation(existing),
        existing: true,
        help: [`Run \`${createAgainCommand(parsed)}\` to create another issue with this title`],
      };
    }
  }

  return runMutation(runtime, {
    tool: "save_issue",
    args: toolArgs,
    team: toolArgs.team,
    help: ISSUE_CREATE_HELP,
    render: (issue) => ({ issue: compactIssueMutation(issue) }),
  });
}

async function updateIssueCommand(args, runtime) {
  const parsed = parseFlags(args, {
    command: "issues update",
    value: [...ISSUE_FIELDS, "id", "description-file"],
    array: ["label", "remove-label"],
  });
  if (parsed.help) return issueUpdateHelp();
  requireValue(parsed.id, "updating an issue requires --id", ISSUE_UPDATE_HELP);
  const toolArgs: InputRecord = { id: parsed.id, ...collectKnownArgs(parsed, ISSUE_FIELDS) };
  // save_issue `labels` replaces the whole label set; updates add and remove instead so
  // existing labels are never dropped by accident.
  if (parsed.label) toolArgs.addLabels = parsed.label;
  if (parsed["remove-label"]) toolArgs.removeLabels = parsed["remove-label"];
  await applyTextFileFlag(toolArgs, parsed, {
    flag: "description-file",
    field: "description",
    cwd: runtime.cwd,
  });
  if (Object.keys(toolArgs).length === 1) {
    throw usage("issues update needs at least one field to change", [commandHelp("issues update")]);
  }
  const issue = await ensureIssueExists(toolArgs.id, runtime);
  const id = formatCommandArg(toolArgs.id);
  return runMutation(runtime, {
    tool: "save_issue",
    args: toolArgs,
    team: toolArgs.team ?? issue.team?.key ?? issue.team?.name ?? issue.team,
    help: [
      `Run \`linear-axi issues view ${id}\` to check the current values`,
      commandHelp("issues update"),
    ],
    render: (saved) => ({ issue: compactIssueMutation(saved) }),
  });
}

function createAgainCommand(parsed) {
  const flags = [...ISSUE_FIELDS.filter((name) => name !== "description"), "description-file"];
  const command = commandLine("linear-axi issues create", parsed, [...flags, "label"], {
    "allow-duplicate": true,
  });
  return parsed.description === undefined ? command : `${command} --description "<description>"`;
}
