import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { AxiError as SdkAxiError, exitCodeForError, runAxiCli } from "axi-sdk-js";
import { usage } from "./args.ts";
import { resolveMcpUrl } from "./config.ts";
import { renderToon } from "./format.ts";
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
import { LIST_TOOL_ALIASES, normalizeError } from "./commands/shared.ts";
import { statusCommand } from "./commands/statuses.ts";
import { DESCRIPTION } from "./skill.ts";

const { version: VERSION } = createRequire(import.meta.url)("../package.json");

const COMMANDS = {
  ...Object.fromEntries(
    Object.keys(LIST_TOOL_ALIASES).map((command) => [
      command,
      (args, runtime) => listResourceCommand(command, args, runtime),
    ]),
  ),
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
};

export async function main(args, context) {
  await runAxiCli(cliOptions(args, context));
}

export async function run(args, runtime) {
  if (args.length === 0) {
    return renderToon(await homeCommand(runtime));
  }

  const [command, ...rest] = args;
  if (command === "--help" || command === "-h") return topHelp();
  const handler = COMMANDS[command];
  if (handler) return handler(rest, runtime);

  throw usage(`unknown command: ${command}`, [
    "Run `linear-axi`",
    'Run `linear-axi init --project "<project>"`',
    "Run `linear-axi issues list`",
    "Run `linear-axi projects list`",
    "Run `linear-axi teams list`",
  ]);
}

function trimFinalNewline(output) {
  return typeof output === "string" ? output.replace(/\n$/, "") : output;
}

function cliOptions(args, context) {
  return {
    argv: args.length === 1 && args[0] === "-h" ? ["--help"] : args,
    stdout: context.stdout,
    description: DESCRIPTION,
    version: VERSION,
    topLevelHelp: topHelp(),
    home: withRuntimeCleanup(async (_args, runtime) => homeCommand(runtime)),
    commands: Object.fromEntries(
      Object.entries(COMMANDS).map(([name, command]) => [
        name,
        withRuntimeCleanup(async (commandArgs, runtime) =>
          trimFinalNewline(await command(commandArgs, runtime)),
        ),
      ]),
    ),
    resolveContext: () => makeRuntime(context),
    formatError,
  };
}

function withRuntimeCleanup(handler) {
  return async (args, runtime) => {
    try {
      return await handler(args, runtime);
    } finally {
      await runtime?.client?.close();
    }
  };
}

function formatError(error) {
  if (error instanceof SdkAxiError) {
    return {
      output: renderToon({
        error: error.message,
        code: error.code,
        ...(error.suggestions.length > 0 ? { help: error.suggestions } : {}),
      }),
      exitCode: exitCodeForError(error),
    };
  }

  const axiError = normalizeError(error);
  return {
    output: renderToon({
      error: axiError.message,
      code: axiError.code,
      type: axiError.type,
      ...(axiError.help.length > 0 ? { help: axiError.help } : {}),
    }),
    exitCode: axiError.exitCode,
  };
}

async function makeRuntime(context) {
  const url = await resolveMcpUrl(context.env);
  return {
    cwd: context.cwd,
    env: context.env,
    binPath: executablePath(),
    mcpUrl: url,
    stdout: context.stdout,
    client:
      context.client ??
      new LinearMcpClient({
        url,
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
