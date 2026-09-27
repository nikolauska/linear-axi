import { AxiError } from "axi-sdk-js";
import type { ParsedFlags, ParseFlagOptions } from "./types.ts";

export { AxiError };

export function parseFlags(args: string[], options: ParseFlagOptions): ParsedFlags {
  const parsed: ParsedFlags = { positionals: [], command: options.command };
  const booleanFlags = new Set(["help", ...(options.boolean ?? [])]);
  const arrayFlags = new Set(options.array ?? []);
  const valueFlags = new Set([...(options.value ?? []), ...arrayFlags]);
  const helpHint = commandHelp(options.command);

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];

    if (arg === "--") {
      parsed.positionals.push(...args.slice(index + 1));
      break;
    }

    if (arg === "-h") {
      parsed.help = true;
      continue;
    }

    if (!arg.startsWith("--")) {
      parsed.positionals.push(arg);
      continue;
    }

    const equals = arg.indexOf("=");
    const name = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
    if (!name) {
      throw usage("empty flag name", [helpHint]);
    }
    // Unknown flags used to be dropped silently, which turned typos into unfiltered lists
    // and no-op mutations that still reported success.
    if (!booleanFlags.has(name) && !valueFlags.has(name)) {
      throw usage(`unknown flag --${name} for linear-axi ${options.command}`, [helpHint]);
    }

    let value;
    if (booleanFlags.has(name)) {
      value = equals === -1 ? true : parseBoolean(arg.slice(equals + 1), name, helpHint);
    } else if (equals !== -1) {
      value = arg.slice(equals + 1);
    } else {
      index += 1;
      if (index >= args.length) {
        throw usage(`--${name} requires a value`, [helpHint]);
      }
      value = args[index];
    }

    if (arrayFlags.has(name)) {
      parsed[name] = [...(parsed[name] ?? []), value];
    } else if (parsed[name] !== undefined && name !== "help") {
      throw usage(`--${name} was given more than once`, [helpHint]);
    } else {
      parsed[name] = value;
    }
  }

  const maxPositionals = options.positionals ?? 0;
  if (!parsed.help && parsed.positionals.length > maxPositionals) {
    throw usage(`unexpected argument: ${parsed.positionals[maxPositionals]}`, [helpHint]);
  }

  return parsed;
}

export function commandHelp(command: string) {
  return `Run \`linear-axi ${command} --help\``;
}

function parseBoolean(value, flagName, helpHint) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw usage(`--${flagName} must be true or false`, [helpHint]);
}

export function usage(message: string, help: string[] = []) {
  return new AxiError(message, "VALIDATION_ERROR", help);
}

export function notFound(resource: string, id: string, help: string[] = []) {
  return new AxiError(`${resource} not found: ${id}`, "NOT_FOUND", help);
}

export function operationError(message: string, help: string[] = []) {
  return new AxiError(message, "OPERATION_ERROR", help);
}
