import { topHelp } from "./commands/help.js";

export const SKILL_DESCRIPTION =
  "Operate Linear through the linear-axi CLI - issues, projects, teams, users, comments, documents, " +
  "milestones, cycles, statuses, labels, auth, and repo project setup. Use whenever a task touches " +
  "Linear: listing or creating issues, updating project work, reading documents, or managing comments. " +
  "Do not use for non-Linear issue trackers.";

export const DESCRIPTION =
  "Agent ergonomic wrapper around the configured Linear MCP server. Prefer this over raw Linear MCP calls for Linear operations.";

export function extractCommandsBlock() {
  const match = topHelp().match(/^(commands\[\d+\]:\n(?: {2}.*\n)+)/m);
  if (!match) {
    throw new Error("Could not find commands block in top help");
  }
  return match[1].trimEnd();
}

export function createSkillMarkdown() {
  return `---
name: linear-axi
description: ${JSON.stringify(SKILL_DESCRIPTION)}
---

# linear-axi

${DESCRIPTION}

Check whether \`linear-axi\` is installed before using it. If it is missing, ask the user to install it globally with \`npm install -g @nikolauska/linear-axi\`.
linear-axi requires Node.js 20 or newer.

linear-axi uses the configured Linear MCP server. The default remote endpoint uses OAuth; if authorization is required, run \`linear-axi auth login\`. Run \`linear-axi auth logout\` to clear saved OAuth credentials without changing bearer-token environment variables.

## When to use

Use linear-axi whenever a task touches Linear: listing, viewing, creating, or updating issues; browsing or editing projects and documents; creating or listing comments; checking teams, users, labels, cycles, milestones, or statuses; or binding the current repo to a default Linear project.

## Workflow

1. Run \`linear-axi\` with no arguments for a dashboard of the current repo. Uninitialized repos show setup hints instead of workspace-wide issue counts.
2. List Linear projects with \`linear-axi projects list\`, then bind a repository with \`linear-axi init --project "<project>"\`; this accepts a project id, name, or slug, validates the project, and stores discovered workspace metadata in \`.linear-project\`.
3. Drill in command-first: \`issues list\`, \`issues view <id>\`, \`projects list\`, \`documents view <id>\`, \`comments list --issue <id>\`, and so on.
4. Add \`--fields\` for columns, \`--cursor\` for pagination, and \`--full\` only when complete content is needed.
5. Linear operation responses include contextual next-step hints under \`help:\` when recovery or follow-up is useful - follow them.
6. Before a destructive or broad mutation, verify the target and ask for confirmation unless the user already requested that exact change.

## Commands

\`\`\`
${extractCommandsBlock()}
\`\`\`

Installed copies also inherit the SDK built-in \`update\` command.
Run \`linear-axi update --check\` to compare the installed version with npm, or \`linear-axi update\` to upgrade.

Run \`linear-axi --help\` for global flags, \`linear-axi <resource> --help\` for grouped subcommands, or \`linear-axi <resource> <action> --help\` for focused flags.

## Tips

- Never print bearer-token environment variables or OAuth tokens.
- Linear command output is TOON-encoded and token-efficient; pipe through grep/head only when a list is very long.
- Default issue and project lists are grouped by status, show active work first, and keep ids last. Use \`--fields\` when you need a custom column order.
- Mutations validate targets and report compact results. After a transport or response failure, inspect the target before retrying to avoid duplicate changes.
- For multi-line markdown descriptions, comments, or documents, write the text to a UTF-8 file and pass \`--description-file <path>\`, \`--body-file <path>\`, or \`--content-file <path>\`.
- Repository project defaults are validated before an issue, document, or milestone command uses them unless \`--project <project>\` overrides them. Use \`--all-projects\` on issue and document list commands only when a workspace-wide list is intended.
`;
}
