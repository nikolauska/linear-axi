import { collapseHome } from "../config.ts";
import { formatCommandArg } from "../lib/cli-helpers.ts";
import { paginationInfo } from "../lib/linear-format.ts";
import { asArray, callAvailableTool, callToolData } from "../lib/mcp-tools.ts";
import { extractWorkspaceName, readRepoProject, validateRepoProject } from "../lib/repo-project.ts";
import { COMMAND_NAMES } from "./help.ts";
import { normalizeError, workspaceName } from "./shared.ts";
import type { InputRecord } from "../types.ts";

const COMMANDS_HINT = `Run \`linear-axi <command> --help\` — commands: ${COMMAND_NAMES.join(", ")}`;

export async function homeCommand(runtime) {
  const repoProject = await readRepoProject(runtime.cwd);
  const workspace = await linearWorkspace(runtime);

  const output: InputRecord = {
    bin: collapseHome(runtime.binPath),
    workspace: workspace.name,
  };

  if (!repoProject) {
    output.project = "not initialized";
    output.repo = await workspaceName(runtime.cwd);
    // A failed lookup used to show `workspace: unknown` with no hint that Linear was unreachable.
    if (workspace.error) {
      output.status = "Linear MCP connection unavailable";
      output.error = workspace.error.message;
      output.help = [...workspace.error.suggestions, COMMANDS_HINT];
      return output;
    }
    output.status = "No default Linear project is configured for this repository";
    output.help = [
      "Run `linear-axi projects list` to find Linear projects",
      'Run `linear-axi init --project "<project>"` to bind this repo',
      "Run `linear-axi issues list --assignee me --all-projects` to list your assigned issues across Linear",
      COMMANDS_HINT,
    ];
    return output;
  }

  let issueCount = 0;
  let issueMore = false;
  let error;
  try {
    const validatedProject = await validateRepoProject(repoProject, runtime);
    const data = await callToolData(runtime, "list_issues", {
      assignee: "me",
      limit: 10,
      orderBy: "updatedAt",
      project: validatedProject.project,
    });
    issueCount = asArray(data).length;
    issueMore = Boolean(paginationInfo(data, issueCount).cursor);
  } catch (caught) {
    error = normalizeError(caught, runtime);
  }

  output.project = repoProject.project;
  output.repo = await workspaceName(runtime.cwd);

  if (error?.message.startsWith("The saved default Linear project does not exist")) {
    output.status = "Default Linear project is invalid";
    output.error = error.message;
    output.help = [
      `Run \`linear-axi projects list --query ${formatCommandArg(repoProject.project)} --fields id,name,status\` to search the current workspace`,
      'Run `linear-axi init --project "<project>" --force` to update .linear-project',
    ];
    return output;
  }

  if (error) {
    output.status = "Linear MCP connection unavailable";
    output.error = error.message;
    output.help = [...error.suggestions, COMMANDS_HINT];
    return output;
  }

  output.issues = `${issueCount}${issueMore ? "+" : ""} assigned to me in project`;
  output.help = ["Run `linear-axi issues list --assignee me` to list them", COMMANDS_HINT];
  return output;
}

async function linearWorkspace(runtime) {
  try {
    const data = await callAvailableTool(
      runtime,
      ["get_organization", "get_workspace", "list_projects", "list_teams"],
      (toolName) => (["list_projects", "list_teams"].includes(toolName) ? { limit: 1 } : {}),
    );
    return { name: extractWorkspaceName(data) ?? "unknown", error: null };
  } catch (caught) {
    return { name: "unknown", error: normalizeError(caught, runtime) };
  }
}
