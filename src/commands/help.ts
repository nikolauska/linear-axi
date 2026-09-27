// One command list feeds top help, the dashboard hint, and the generated skill so they cannot drift.
export const COMMAND_NAMES = [
  "init",
  "auth",
  "issues",
  "projects",
  "teams",
  "users",
  "comments",
  "documents",
  "milestones",
  "cycles",
  "statuses",
  "labels",
];

export function topHelp() {
  return `usage: linear-axi [command] [args] [flags]
commands[${COMMAND_NAMES.length + 1}]:
  (none)=dashboard, ${COMMAND_NAMES.join(", ")}
flags[3]:
  --help, -h, -v/-V/--version
examples:
  linear-axi
  linear-axi init --project "Roadmap"
  linear-axi auth login
  linear-axi issues list --assignee me --all-projects --limit 25
  linear-axi projects create --name "Roadmap" --team ENG
  linear-axi documents view <id>
  linear-axi issues update --id LIN-123 --state Done
  linear-axi comments create --issue LIN-123 --body "Ready for review."
  linear-axi update --check
env[5]:
  LINEAR_AXI_MCP_URL, LINEAR_AXI_MCP_TOKEN, LINEAR_MCP_TOKEN, LINEAR_AXI_AUTH_FILE, CODEX_CONFIG
`;
}

export function initHelp() {
  return `usage: linear-axi init --project <project> [--force]
description: Validate and save the current Git repository's default Linear project in .linear-project.
flags:
  --project <project>  Linear project id, name, or slug to use by default
  --force             replace an existing .linear-project value
examples:
  linear-axi init --project "Roadmap"
  linear-axi init --project p_123 --force
`;
}

export function groupHelp(name, subcommands) {
  const examples = {
    issues: [
      "linear-axi issues list --assignee me --all-projects --limit 25",
      "linear-axi issues view LIN-123",
      'linear-axi issues create --title "Fix auth" --team ENG',
      "linear-axi issues update --id LIN-123 --state Done",
    ],
    projects: [
      "linear-axi projects list --limit 25",
      'linear-axi projects create --name "Roadmap" --team ENG',
      'linear-axi projects update --id <id> --summary "Updated scope"',
    ],
    documents: [
      "linear-axi documents list --all-projects --limit 25",
      "linear-axi documents view <id>",
      'linear-axi documents create --title "Spec" --team ENG --content-file spec.md',
      'linear-axi documents update --id <id> --content "Updated"',
    ],
    comments: [
      "linear-axi comments list --issue LIN-123",
      'linear-axi comments create --issue LIN-123 --body "Ready for review."',
    ],
    auth: [
      "linear-axi auth login",
      "linear-axi auth login --manual",
      "linear-axi auth finish --code <code>",
      "linear-axi auth logout",
    ],
    milestones: [
      "linear-axi milestones list",
      'linear-axi milestones view "Beta"',
      'linear-axi milestones create --name "Beta" --targetDate 2026-12-01',
      "linear-axi milestones update --id <id> --targetDate 2026-12-15",
    ],
    cycles: ["linear-axi cycles list --team ENG --type current"],
    statuses: ["linear-axi statuses list --team ENG"],
  };
  const flags = GROUP_FLAG_HELP[name]?.join("\n") ?? "";
  return `usage: linear-axi ${name} <subcommand> [flags]
subcommands[${subcommands.length}]:
  ${subcommands.join(", ")}
${flags ? `${flags}\n` : ""}examples:
${(examples[name] ?? [`linear-axi ${name} list`]).map((example) => `  ${example}`).join("\n")}
detail: run \`linear-axi ${name} <subcommand> --help\` for every flag
`;
}

export function commentListHelp() {
  return `usage: linear-axi comments list --issue <id> [--full]
flags:
  --issue <id>  required
  --limit <n> default 50
  --cursor <cursor>
  --orderBy createdAt|updatedAt
  --full
examples:
  linear-axi comments list --issue LIN-123
  linear-axi comments list --issue LIN-123 --full
`;
}

export function commentCreateHelp() {
  return `usage: linear-axi comments create --issue <id> (--body <text> | --body-file <path>)
flags:
  --issue <id>  required
  --body <markdown>
  --body-file <path>  UTF-8 file; use instead of --body for multi-line text
examples:
  linear-axi comments create --issue LIN-123 --body "Ready for review."
  linear-axi comments create --issue LIN-123 --body-file note.md
`;
}

const DOCUMENT_FIELDS_HELP = `  --title <title>
  --team <team>
  --project <project>
  --issue <issue>
  --initiative <initiative>
  --cycle <cycle>
  --color <color>
  --icon <icon>
  --content <markdown>
  --content-file <path>  use instead of --content
`;

export function documentCreateHelp() {
  return `usage: linear-axi documents create --title <title> [parent] [--content <markdown> | --content-file <path>]
description: Without --team, --issue, --initiative, or --cycle the repo default project is used.
flags:
${DOCUMENT_FIELDS_HELP}examples:
  linear-axi documents create --title "Spec" --team ENG --content-file spec.md
`;
}

export function documentUpdateHelp() {
  return `usage: linear-axi documents update --id <id> [fields]
flags:
  --id <id>  required
${DOCUMENT_FIELDS_HELP}examples:
  linear-axi documents update --id <id> --content "Updated"
`;
}

export function documentViewHelp() {
  return `usage: linear-axi documents view <id> [--full]
examples:
  linear-axi documents view <id>
  linear-axi documents view <id> --full
`;
}

const PROJECT_FIELDS_HELP = `  --name <name>
  --team <team>
  --teamId <team-id>
  --summary <text>
  --description <markdown>
  --state <status>  project status name, type, or id
  --lead <user>
  --startDate <yyyy-mm-dd>
  --targetDate <yyyy-mm-dd>
`;

export function projectCreateHelp() {
  return `usage: linear-axi projects create --name <name> --team <team> [fields]
description: If a project with the same name already exists for the team, it is returned with existing: true.
flags:
${PROJECT_FIELDS_HELP}  --allow-duplicate  create a new project even when one with the same name exists
examples:
  linear-axi projects create --name "Roadmap" --team ENG
`;
}

export function projectUpdateHelp() {
  return `usage: linear-axi projects update --id <id> [fields]
flags:
  --id <id>  required
${PROJECT_FIELDS_HELP}examples:
  linear-axi projects update --id <id> --summary "Updated scope"
`;
}

export function milestoneListHelp() {
  return `usage: linear-axi milestones list [--project <project>] [--full]
flags:
  --project <project>  overrides the repo default project
  --full
examples:
  linear-axi milestones list
  linear-axi milestones list --project "Roadmap"
`;
}

export function milestoneViewHelp() {
  return `usage: linear-axi milestones view [--project <project>] <milestone> [--full]
flags:
  --project <project>  overrides the repo default project
  --full
examples:
  linear-axi milestones view "Beta"
  linear-axi milestones view --project "Roadmap" "Beta"
`;
}

export function milestoneCreateHelp() {
  return `usage: linear-axi milestones create [--project <project>] --name <name>
flags:
  --name <name>  required
  --project <project>  overrides the repo default project
  --description <markdown>
  --targetDate <yyyy-mm-dd>
examples:
  linear-axi milestones create --name "Beta"
  linear-axi milestones create --project "Roadmap" --name "Beta"
`;
}

export function milestoneUpdateHelp() {
  return `usage: linear-axi milestones update [--project <project>] --id <id> [fields]
flags:
  --id <id>  required
  --project <project>  overrides the repo default project
  --name <name>
  --description <markdown>
  --targetDate <yyyy-mm-dd>
examples:
  linear-axi milestones update --id <id> --targetDate 2026-12-15
  linear-axi milestones update --project "Roadmap" --id <id> --name "Beta 2"
`;
}

export function cycleListHelp() {
  return `usage: linear-axi cycles list --team <team> [--type current|previous|next|all] [--full]
flags:
  --team <team>  team key, name, or id
  --teamId <team-id>
  --type current|previous|next|all  default all
  --full
examples:
  linear-axi cycles list --team ENG --type current
`;
}

export function statusListHelp() {
  return `usage: linear-axi statuses list --team <team> [--full]
flags:
  --team <team>  team key, name, or id
  --teamId <team-id>
  --full
examples:
  linear-axi statuses list --team ENG
  linear-axi statuses list --team ENG --full
`;
}

export function issueViewHelp() {
  return `usage: linear-axi issues view <id> [--full]
examples:
  linear-axi issues view LIN-123
  linear-axi issues view LIN-123 --full
`;
}

const ISSUE_FIELDS_HELP = `  --title <title>
  --team <team>
  --state <state>
  --assignee <user>
  --project <project>
  --cycle <cycle>
  --parentId <issue-id>
  --priority <0-4>  0 none, 1 urgent, 2 high, 3 medium, 4 low
  --estimate <number>
  --dueDate <yyyy-mm-dd>
  --description <markdown>
  --description-file <path>  use instead of --description
`;

export function issueCreateHelp() {
  return `usage: linear-axi issues create --title <title> --team <team> [fields]
description: Uses the repo default project unless --project is given. If an issue with the same title already exists for the team, it is returned with existing: true.
flags:
${ISSUE_FIELDS_HELP}  --label <label>  repeatable
  --allow-duplicate  create a new issue even when one with the same title exists
examples:
  linear-axi issues create --title "Fix auth" --team ENG
  linear-axi issues create --title "Task" --team ENG --project "Roadmap" --label Bug
`;
}

export function issueUpdateHelp() {
  return `usage: linear-axi issues update --id <id> [fields]
flags:
  --id <id>  required
${ISSUE_FIELDS_HELP}  --label <label>  add a label; repeatable
  --remove-label <label>  remove a label; repeatable
examples:
  linear-axi issues update --id LIN-123 --state Done
  linear-axi issues update --id LIN-123 --label Bug --remove-label Triage
`;
}

export function authLoginHelp() {
  return `usage: linear-axi auth login [--manual] [--timeout <ms>]
description: Waits for the browser callback; the authorization URL is printed on stderr.
flags:
  --manual print the authorization URL and exit so you can paste the code into auth finish
  --timeout <ms> default 300000
examples:
  linear-axi auth login
  linear-axi auth login --manual
`;
}

export function authFinishHelp() {
  return `usage: linear-axi auth finish --code <code>
examples:
  linear-axi auth finish --code <code>
`;
}

export function authLogoutHelp() {
  return `usage: linear-axi auth logout
description: Remove saved Linear MCP OAuth credentials for the configured endpoint without changing bearer-token environment variables.
examples:
  linear-axi auth logout
`;
}

const GROUP_FLAG_HELP = {
  issues: [
    "flags{list}:\n  --assignee <user>, --state <state>, --team <team>, --project <project>, --all-projects, --query <text>, --label <label>, --limit <n> (default 50), --fields <a,b,c>, --full",
    "flags{view}:\n  --full (show complete description without truncation)",
    "flags{create}:\n  --title <text> (required), --team <team> (required), --description <markdown> or --description-file <path>, --state <state>, --assignee <user>, --project <project>, --label <label>, --priority <0-4>, --allow-duplicate",
    "flags{update}:\n  --id <id> (required), --title <text>, --description <markdown> or --description-file <path>, --state <state>, --assignee <user>, --project <project>, --label <label>, --remove-label <label>, --priority <0-4>",
  ],
  projects: [
    "flags{list}:\n  --query <text>, --team <team>, --state <state>, --limit <n> (default 50), --fields <a,b,c>, --full",
    "flags{create}:\n  --name <text> (required), --team <team> or --teamId <id> (required), --summary <text>, --description <markdown>, --state <status>, --lead <user>, --allow-duplicate",
    "flags{update}:\n  --id <id> (required), --name <text>, --team <team> or --teamId <id>, --summary <text>, --description <markdown>, --state <status>, --lead <user>",
  ],
  documents: [
    "flags{list}:\n  --project <project>, --all-projects, --query <text>, --team <team>, --limit <n> (default 50), --fields <a,b,c>, --full",
    "flags{view}:\n  --full (show complete content without truncation)",
    "flags{create}:\n  --title <text> (required), --team <team>, --project <project>, --issue <issue>, --content <markdown> or --content-file <path>",
    "flags{update}:\n  --id <id> (required), --title <text>, --team <team>, --project <project>, --issue <issue>, --content <markdown> or --content-file <path>",
  ],
  comments: [
    "flags{list}:\n  --issue <id> (required), --limit <n> (default 50), --cursor <cursor>, --full",
    "flags{create}:\n  --issue <id> (required), --body <text> or --body-file <path> (required)",
  ],
};
