import { commandHelp, parseFlags, usage } from "../args.ts";
import {
  collectKnownArgs,
  commandLine,
  dispatchCommandGroup,
  formatCommandArg,
  rejectIdOnCreate,
  requireValue,
} from "../lib/cli-helpers.ts";
import { compactProjectMutation } from "../lib/linear-format.ts";
import { groupHelp, projectCreateHelp, projectUpdateHelp } from "./help.ts";
import { aliasListCommand } from "./list-resource.ts";
import {
  ensureProjectExists,
  findExistingProject,
  projectSaveToolArgs,
  runMutation,
} from "./shared.ts";

// save_project has no `status` input; project status is set through `state`.
const PROJECT_FIELDS = [
  "name",
  "team",
  "teamId",
  "summary",
  "description",
  "state",
  "lead",
  "startDate",
  "targetDate",
];
const PROJECT_CREATE_HELP = [
  'Run `linear-axi projects create --name "<name>" --team "<team>"`',
  "Run `linear-axi teams list` to choose a team",
];
const PROJECT_UPDATE_HELP = [
  'Run `linear-axi projects update --id <id> --summary "<summary>"`',
  'Run `linear-axi projects list --query "<name>" --fields id,name,status` to find the project id',
];
const PROJECT_ID_ON_CREATE_HELP = [
  'Run `linear-axi projects create --name "<name>" --team "<team>"`',
  'Run `linear-axi projects update --id <id> --summary "<summary>"` to edit an existing project',
];

export async function projectCommand(args, runtime) {
  return dispatchCommandGroup(args, {
    name: "projects",
    help: () => groupHelp("projects", ["list", "create", "update"]),
    handlers: {
      list: (rest) => aliasListCommand("projects", rest, runtime),
      create: (rest) => createProjectCommand(rest, runtime),
      update: (rest) => updateProjectCommand(rest, runtime),
    },
    unknownHelp: [
      "Run `linear-axi projects list`",
      'Run `linear-axi projects create --name "<name>" --team "<team>"`',
    ],
  });
}

async function createProjectCommand(args, runtime) {
  const parsed = parseFlags(args, {
    command: "projects create",
    value: [...PROJECT_FIELDS, "id"],
    boolean: ["allow-duplicate"],
  });
  if (parsed.help) return projectCreateHelp();
  rejectIdOnCreate("project", PROJECT_ID_ON_CREATE_HELP, parsed);
  const toolArgs = collectKnownArgs(parsed, PROJECT_FIELDS);
  const team = toolArgs.team ?? toolArgs.teamId;
  requireValue(
    toolArgs.name && team,
    "creating a project requires --name and --team",
    PROJECT_CREATE_HELP,
  );
  // Same retry-safety contract as issues: an existing match is returned unless a duplicate is
  // requested explicitly.
  if (!parsed["allow-duplicate"]) {
    const existing = await findExistingProject(toolArgs.name, team, runtime);
    if (existing) {
      const again = commandLine(
        "linear-axi projects create",
        parsed,
        PROJECT_FIELDS.filter((name) => name !== "description"),
        { "allow-duplicate": true },
      );
      return {
        project: compactProjectMutation(existing),
        existing: true,
        help: [
          `Run \`${parsed.description === undefined ? again : `${again} --description "<description>"`}\` to create another project with this name`,
        ],
      };
    }
  }
  return saveProject(toolArgs, runtime, ["create_project", "save_project"], PROJECT_CREATE_HELP);
}

async function updateProjectCommand(args, runtime) {
  const parsed = parseFlags(args, { command: "projects update", value: [...PROJECT_FIELDS, "id"] });
  if (parsed.help) return projectUpdateHelp();
  requireValue(parsed.id, "updating a project requires --id", PROJECT_UPDATE_HELP);
  const toolArgs = { id: parsed.id, ...collectKnownArgs(parsed, PROJECT_FIELDS) };
  if (Object.keys(toolArgs).length === 1) {
    throw usage("projects update needs at least one field to change", [
      commandHelp("projects update"),
    ]);
  }
  await ensureProjectExists(toolArgs.id, runtime);
  return saveProject(
    toolArgs,
    runtime,
    ["update_project", "save_project"],
    [
      `Run \`linear-axi projects list --query ${formatCommandArg(toolArgs.id)} --full\` to check the current values`,
      commandHelp("projects update"),
    ],
  );
}

async function saveProject(toolArgs, runtime, toolNames, help) {
  return runMutation(runtime, {
    toolNames,
    argsForTool: (toolName) => projectSaveToolArgs(toolName, toolArgs),
    team: toolArgs.team ?? toolArgs.teamId,
    help,
    render: (project) => ({ project: compactProjectMutation(project) }),
  });
}
