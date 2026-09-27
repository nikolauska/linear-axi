import { parseFlags, usage } from "../args.ts";
import { dispatchCommandGroup, requireTeam } from "../lib/cli-helpers.ts";
import { compactRows } from "../lib/linear-format.ts";
import { callToolData } from "../lib/mcp-tools.ts";
import { cycleListHelp, groupHelp } from "./help.ts";
import { resolveTeamId } from "./shared.ts";

const CYCLE_TYPES = ["current", "previous", "next", "all"];

export async function cycleCommand(args, runtime) {
  return dispatchCommandGroup(args, {
    name: "cycles",
    help: () => groupHelp("cycles", ["list"]),
    handlers: {
      list: (rest) => listCyclesCommand(rest, runtime),
    },
    unknownHelp: ['Run `linear-axi cycles list --team "<team>"`'],
  });
}

async function listCyclesCommand(args, runtime) {
  const parsed = parseFlags(args, {
    command: "cycles list",
    value: ["team", "teamId", "type"],
    boolean: ["full"],
  });
  if (parsed.help) return cycleListHelp();
  const team = requireTeam(parsed, ['Run `linear-axi cycles list --team "<team>"`']);
  if (parsed.type !== undefined && !CYCLE_TYPES.includes(parsed.type)) {
    throw usage(`--type must be one of ${CYCLE_TYPES.join(", ")}`, [
      "Run `linear-axi cycles list --help`",
    ]);
  }
  const toolArgs = {
    teamId: await resolveTeamId(team, runtime),
    // list_cycles returns every cycle when no type is given; it has no literal "all" value.
    ...(parsed.type && parsed.type !== "all" ? { type: parsed.type } : {}),
  };
  const data = await callToolData(runtime, "list_cycles", toolArgs);
  return { cycles: parsed.full ? data : compactRows("cycles", data) };
}
