import { commandHelp, parseFlags, usage } from "../args.ts";
import {
  collectKnownArgs,
  dispatchCommandGroup,
  formatCommandArg,
  rejectIdOnCreate,
  requireValue,
} from "../lib/cli-helpers.ts";
import { compactMilestone, compactRows } from "../lib/linear-format.ts";
import { callToolData } from "../lib/mcp-tools.ts";
import { applyRepoProjectDefault } from "../lib/repo-project.ts";
import {
  groupHelp,
  milestoneCreateHelp,
  milestoneListHelp,
  milestoneUpdateHelp,
  milestoneViewHelp,
} from "./help.ts";
import { detailView, ensureMilestoneExists, runMutation } from "./shared.ts";

const MILESTONE_FIELDS = ["name", "project", "description", "targetDate"];
const MILESTONE_ID_ON_CREATE_HELP = [
  'Run `linear-axi milestones create --project "<project>" --name "<name>"`',
  'Run `linear-axi milestones update --project "<project>" --id <id>` to edit an existing milestone',
];

export async function milestoneCommand(args, runtime) {
  return dispatchCommandGroup(args, {
    name: "milestones",
    help: () => groupHelp("milestones", ["list", "view", "create", "update"]),
    handlers: {
      list: (rest) => listMilestonesCommand(rest, runtime),
      view: (rest) => viewMilestoneCommand(rest, runtime),
      create: (rest) => createMilestoneCommand(rest, runtime),
      update: (rest) => updateMilestoneCommand(rest, runtime),
    },
    unknownHelp: ['Run `linear-axi milestones list --project "<project>"`'],
  });
}

async function listMilestonesCommand(args, runtime) {
  const parsed = parseFlags(args, {
    command: "milestones list",
    value: ["project"],
    boolean: ["full"],
  });
  if (parsed.help) return milestoneListHelp();
  const project = await milestoneProject(parsed, runtime, "linear-axi milestones list");
  const data = await callToolData(runtime, "list_milestones", { project });
  return { milestones: parsed.full ? data : compactRows("milestones", data) };
}

async function viewMilestoneCommand(args, runtime) {
  const parsed = parseFlags(args, {
    command: "milestones view",
    value: ["project", "query"],
    boolean: ["full"],
    positionals: 1,
  });
  if (parsed.help) return milestoneViewHelp();
  const query = parsed.positionals[0] ?? parsed.query;
  if (!query) {
    throw usage("milestone name or id is required", [
      'Run `linear-axi milestones view "<milestone>"`',
    ]);
  }
  const project = await milestoneProject(parsed, runtime, "linear-axi milestones view");
  const milestone = await ensureMilestoneExists(project, query, runtime);
  return detailView({
    resource: "milestone",
    detail: milestone,
    full: parsed.full,
    compact: compactMilestone,
    fullCommand: `linear-axi milestones view --project ${formatCommandArg(project)} ${formatCommandArg(query)} --full`,
  });
}

async function createMilestoneCommand(args, runtime) {
  const parsed = parseFlags(args, {
    command: "milestones create",
    value: [...MILESTONE_FIELDS, "id"],
  });
  if (parsed.help) return milestoneCreateHelp();
  rejectIdOnCreate("milestone", MILESTONE_ID_ON_CREATE_HELP, parsed);
  requireValue(parsed.name, "creating a milestone requires --name", [
    commandHelp("milestones create"),
  ]);
  const toolArgs = collectKnownArgs(parsed, MILESTONE_FIELDS);
  toolArgs.project = await milestoneProject(parsed, runtime, "linear-axi milestones create");
  return saveMilestone(toolArgs, runtime, [commandHelp("milestones create")]);
}

async function updateMilestoneCommand(args, runtime) {
  const parsed = parseFlags(args, {
    command: "milestones update",
    value: [...MILESTONE_FIELDS, "id"],
  });
  if (parsed.help) return milestoneUpdateHelp();
  requireValue(parsed.id, "updating a milestone requires --id", [commandHelp("milestones update")]);
  const changes = collectKnownArgs(parsed, ["name", "description", "targetDate"]);
  if (Object.keys(changes).length === 0) {
    throw usage("milestones update needs at least one field to change", [
      commandHelp("milestones update"),
    ]);
  }
  const project = await milestoneProject(parsed, runtime, "linear-axi milestones update");
  await ensureMilestoneExists(project, parsed.id, runtime);
  return saveMilestone({ id: parsed.id, project, ...changes }, runtime, [
    `Run \`linear-axi milestones view --project ${formatCommandArg(project)} ${formatCommandArg(parsed.id)}\` to check the current values`,
    commandHelp("milestones update"),
  ]);
}

// Every milestone subcommand uses the repo default project unless --project overrides it.
async function milestoneProject(parsed, runtime, command) {
  const toolArgs = collectKnownArgs(parsed, ["project"]);
  await applyRepoProjectDefault(toolArgs, runtime, { command, requireProject: true });
  return toolArgs.project;
}

async function saveMilestone(toolArgs, runtime, help) {
  return runMutation(runtime, {
    tool: "save_milestone",
    args: toolArgs,
    help,
    render: (milestone) => ({ milestone: compactMilestone(milestone).milestone }),
  });
}
