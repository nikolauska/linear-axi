import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { commandHelp, usage } from "../args.ts";
import type { InputRecord, ParsedFlags } from "../types.ts";

const DATE_FLAGS = ["dueDate", "startDate", "targetDate"];

export function appendContinuationHelp(help, baseCommand, parsed, flagNames, cursor) {
  if (!cursor) return help;
  help.push(`Run \`${commandLine(baseCommand, parsed, flagNames, { cursor })}\` to continue`);
  return help;
}

// Suggested follow-up commands must keep the caller's scope (project, filters), otherwise the
// suggestion can fail or silently answer a different question.
export function commandLine(
  baseCommand: string,
  parsed: InputRecord,
  flagNames: string[],
  overrides: InputRecord = {},
) {
  const parts = [baseCommand];
  const values = { ...parsed, ...overrides };
  for (const name of [...flagNames, ...Object.keys(overrides)]) {
    if (values[name] === undefined || parts.includes(`--${name}`)) continue;
    appendFlag(parts, name, values[name]);
  }
  return parts.join(" ");
}

export function formatCommandArg(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:@-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, "'\\''")}'`;
}

export function collectKnownArgs(parsed: ParsedFlags, names: string[]): InputRecord {
  const collected: InputRecord = {};
  for (const name of names) {
    if (parsed[name] !== undefined) collected[name] = coerceArg(parsed, name, parsed[name]);
  }
  return collected;
}

export function rejectIdOnCreate(resource, help, parsed) {
  if (parsed.id !== undefined) {
    const article = /^[aeiou]/i.test(resource) ? "an" : "a";
    throw usage(`creating ${article} ${resource} does not accept --id`, help);
  }
}

export function requireValue(value, message, help) {
  if (!value) throw usage(message, help);
}

export function requireTeam(parsed: ParsedFlags, help) {
  const team = parsed.teamId ?? parsed.team;
  requireValue(team, "--team is required", help);
  return team;
}

export function dispatchCommandGroup(args, options) {
  const [subcommand, ...rest] = args;
  if (subcommand === "--help" || subcommand === "-h") return options.help();

  const handler = options.handlers[subcommand ?? options.defaultSubcommand ?? "list"];
  if (handler) return handler(rest);

  throw usage(`unknown ${options.name} command: ${subcommand ?? ""}`.trim(), options.unknownHelp);
}

export async function readTextFlag(path, cwd, parsed: ParsedFlags) {
  const absolute = isAbsolute(path) ? path : resolve(cwd, path);
  try {
    return await readFile(absolute, "utf8");
  } catch {
    throw usage(`file could not be read: ${path}`, [
      "Rerun with a readable file path",
      commandHelp(parsed.command),
    ]);
  }
}

export async function applyTextFileFlag(toolArgs: InputRecord, parsed: ParsedFlags, options) {
  if (parsed[options.flag] === undefined) return;
  // Accepting both used to drop the file silently; make the caller pick one source.
  if (parsed[options.field] !== undefined) {
    throw usage(`use either --${options.field} or --${options.flag}, not both`, [
      commandHelp(parsed.command),
    ]);
  }
  toolArgs[options.field] = await readTextFlag(parsed[options.flag], options.cwd, parsed);
}

function appendFlag(parts, name, value) {
  if (Array.isArray(value)) {
    for (const item of value) appendFlag(parts, name, item);
    return;
  }
  if (value === true) {
    parts.push(`--${name}`);
    return;
  }
  if (value === false) {
    parts.push(`--${name}=false`);
    return;
  }
  parts.push(`--${name}`, formatCommandArg(value));
}

// Linear rejects out-of-range values with an opaque "Argument Validation Error", so values with
// a documented shape are checked locally where the error can name the flag.
function coerceArg(parsed: ParsedFlags, name: string, value) {
  const help = [commandHelp(parsed.command)];
  if (name === "limit") {
    const limit = Number(value);
    if (!Number.isInteger(limit) || limit < 1) {
      throw usage("--limit must be a positive integer", help);
    }
    return limit;
  }
  if (name === "priority") {
    const priority = Number(value);
    if (!Number.isInteger(priority) || priority < 0 || priority > 4) {
      throw usage(
        "--priority must be 0 (none), 1 (urgent), 2 (high), 3 (medium), or 4 (low)",
        help,
      );
    }
    return priority;
  }
  if (name === "estimate") {
    const estimate = Number(value);
    if (value === "" || !Number.isFinite(estimate)) {
      throw usage("--estimate must be a number", help);
    }
    return estimate;
  }
  if (DATE_FLAGS.includes(name)) {
    if (!isIsoDate(value)) throw usage(`--${name} must be a date in YYYY-MM-DD format`, help);
    return value;
  }
  return value;
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}
