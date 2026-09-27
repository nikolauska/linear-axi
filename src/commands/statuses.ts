import { parseFlags } from "../args.ts";
import { dispatchCommandGroup, requireTeam } from "../lib/cli-helpers.ts";
import { compactRows } from "../lib/linear-format.ts";
import { asArray, callToolData } from "../lib/mcp-tools.ts";
import { groupHelp, statusListHelp } from "./help.ts";

export async function statusCommand(args, runtime) {
  return dispatchCommandGroup(args, {
    name: "statuses",
    help: () => groupHelp("statuses", ["list"]),
    handlers: {
      list: (rest) => listStatusesCommand(rest, runtime),
    },
    unknownHelp: ['Run `linear-axi statuses list --team "<team>"`'],
  });
}

// list_issue_statuses only accepts a team; paging and filter flags were rejected by Linear.
async function listStatusesCommand(args, runtime) {
  const parsed = parseFlags(args, {
    command: "statuses list",
    value: ["team", "teamId"],
    boolean: ["full"],
  });
  if (parsed.help) return statusListHelp();
  const team = requireTeam(parsed, ['Run `linear-axi statuses list --team "<team>"`']);
  const data = await callToolData(runtime, "list_issue_statuses", { team });
  const rows = asArray(data);
  return {
    count: `${rows.length} returned`,
    statuses: parsed.full ? data : compactRows("statuses", data),
    ...(rows.length === 0
      ? { help: ["Run `linear-axi teams list` to check the team name or id"] }
      : {}),
  };
}
