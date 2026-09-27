import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { encode } from "@toon-format/toon";
import { runAxiCli } from "axi-sdk-js";
import { resolveMcpUrl } from "./config.ts";
import { LinearMcpClient } from "./mcp.ts";
import { authCommand } from "./commands/auth.ts";
import { commentCommand } from "./commands/comments.ts";
import { cycleCommand } from "./commands/cycles.ts";
import { documentCommand } from "./commands/documents.ts";
import { topHelp } from "./commands/help.ts";
import { homeCommand } from "./commands/home.ts";
import { initCommand } from "./commands/init.ts";
import { issueCommand } from "./commands/issues.ts";
import { listResourceCommand } from "./commands/list-resource.ts";
import { milestoneCommand } from "./commands/milestones.ts";
import { projectCommand } from "./commands/projects.ts";
import { normalizeError } from "./commands/shared.ts";
import { statusCommand } from "./commands/statuses.ts";
import { DESCRIPTION } from "./skill.ts";
import type { MainContext, Runtime } from "./types.ts";

const { version: VERSION } = createRequire(import.meta.url)("../package.json");

const COMMANDS = {
  init: initCommand,
  auth: authCommand,
  issues: issueCommand,
  issue: issueCommand,
  comments: commentCommand,
  comment: commentCommand,
  milestones: milestoneCommand,
  milestone: milestoneCommand,
  cycles: cycleCommand,
  cycle: cycleCommand,
  statuses: statusCommand,
  status: statusCommand,
  documents: documentCommand,
  document: documentCommand,
  projects: projectCommand,
  project: projectCommand,
  teams: (args, runtime) => listResourceCommand("teams", args, runtime),
  team: (args, runtime) => listResourceCommand("teams", args, runtime),
  users: (args, runtime) => listResourceCommand("users", args, runtime),
  user: (args, runtime) => listResourceCommand("users", args, runtime),
  labels: (args, runtime) => listResourceCommand("labels", args, runtime),
  label: (args, runtime) => listResourceCommand("labels", args, runtime),
};

export async function main(args: string[], context: MainContext) {
  await runAxiCli<Runtime>({
    argv: args.length === 1 && args[0] === "-h" ? ["--help"] : args,
    stdout: context.stdout,
    description: DESCRIPTION,
    version: VERSION,
    topLevelHelp: topHelp(),
    home: withCommandBoundary(async (_args, runtime) => homeCommand(runtime)),
    commands: Object.fromEntries(
      Object.entries(COMMANDS).map(([name, command]) => [name, withCommandBoundary(command)]),
    ),
    resolveContext: () => makeRuntime(context),
    renderUnknownCommand: (command) =>
      `${encode({
        error: `unknown command: ${command}`,
        code: "VALIDATION_ERROR",
        help: ["Run `linear-axi --help` to list commands", "Run `linear-axi` for the dashboard"],
      })}\n`,
  });
}

// The SDK renders AxiError values itself; everything else is translated here so dependency
// failures never reach stdout as raw messages or UNKNOWN codes.
function withCommandBoundary(handler) {
  return async (args, runtime) => {
    try {
      return await handler(args, runtime);
    } catch (error) {
      throw normalizeError(error, runtime);
    } finally {
      await runtime?.client?.close();
    }
  };
}

export async function makeRuntime(context: MainContext): Promise<Runtime> {
  const url = await resolveMcpUrl(context.env);
  return {
    cwd: context.cwd,
    env: context.env,
    binPath: executablePath(),
    mcpUrl: url,
    stdout: context.stdout,
    stderr: context.stderr,
    client:
      context.client ??
      new LinearMcpClient({
        url,
        version: VERSION,
        token: context.env.LINEAR_AXI_MCP_TOKEN ?? context.env.LINEAR_MCP_TOKEN,
        authStorePath: context.env.LINEAR_AXI_AUTH_FILE,
      }),
  };
}

function executablePath() {
  try {
    return realpathSync(process.argv[1]);
  } catch {
    return process.argv[1] ?? "linear-axi";
  }
}
