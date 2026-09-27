import { commandHelp, parseFlags, usage } from "../args.ts";
import {
  applyTextFileFlag,
  collectKnownArgs,
  dispatchCommandGroup,
  formatCommandArg,
  rejectIdOnCreate,
  requireValue,
} from "../lib/cli-helpers.ts";
import { compactDocumentDetail, compactDocumentMutation } from "../lib/linear-format.ts";
import { applyRepoProjectDefault } from "../lib/repo-project.ts";
import { documentCreateHelp, documentUpdateHelp, documentViewHelp, groupHelp } from "./help.ts";
import { aliasListCommand } from "./list-resource.ts";
import { detailView, ensureDocumentExists, runMutation } from "./shared.ts";

const DOCUMENT_FIELDS = [
  "title",
  "team",
  "project",
  "issue",
  "initiative",
  "cycle",
  "color",
  "icon",
  "content",
];
const DOCUMENT_CREATE_HELP = [
  'Run `linear-axi documents create --title "<title>" --team "<team>"`',
  commandHelp("documents create"),
];
const DOCUMENT_UPDATE_HELP = [
  'Run `linear-axi documents update --id <id> --content "<markdown>"`',
  "Run `linear-axi documents list --all-projects --query <text>` to find the document id",
];
const DOCUMENT_ID_ON_CREATE_HELP = [
  'Run `linear-axi documents create --title "<title>" --team "<team>" --content-file <path>`',
  'Run `linear-axi documents update --id <id> --content "<markdown>"` to edit an existing document',
];

export async function documentCommand(args, runtime) {
  return dispatchCommandGroup(args, {
    name: "documents",
    help: () => groupHelp("documents", ["list", "view", "create", "update"]),
    handlers: {
      list: (rest) => aliasListCommand("documents", rest, runtime),
      view: (rest) => viewDocumentCommand(rest, runtime),
      create: (rest) => createDocumentCommand(rest, runtime),
      update: (rest) => updateDocumentCommand(rest, runtime),
    },
    unknownHelp: [
      "Run `linear-axi documents list`",
      "Run `linear-axi documents view <id>`",
      'Run `linear-axi documents create --title "<title>" --team "<team>"`',
    ],
  });
}

async function viewDocumentCommand(args, runtime) {
  const parsed = parseFlags(args, {
    command: "documents view",
    value: ["id"],
    boolean: ["full"],
    positionals: 1,
  });
  if (parsed.help) return documentViewHelp();
  const id = parsed.positionals[0] ?? parsed.id;
  if (!id) throw usage("document id is required", ["Run `linear-axi documents view <id>`"]);
  const detail = await ensureDocumentExists(id, runtime);
  return detailView({
    resource: "document",
    detail,
    full: parsed.full,
    compact: (document) => compactDocumentDetail(document, id),
    fullCommand: `linear-axi documents view ${formatCommandArg(id)} --full`,
  });
}

async function createDocumentCommand(args, runtime) {
  const parsed = parseFlags(args, {
    command: "documents create",
    value: [...DOCUMENT_FIELDS, "id", "content-file"],
  });
  if (parsed.help) return documentCreateHelp();
  rejectIdOnCreate("document", DOCUMENT_ID_ON_CREATE_HELP, parsed);
  requireValue(parsed.title, "creating a document requires --title", DOCUMENT_CREATE_HELP);
  const toolArgs = await documentToolArgs(parsed, runtime);
  if (!toolArgs.team && !toolArgs.issue && !toolArgs.initiative && !toolArgs.cycle) {
    await applyRepoProjectDefault(toolArgs, runtime, {
      command: "linear-axi documents create",
      requireProject: true,
    });
  }
  return saveDocument(
    toolArgs,
    runtime,
    ["create_document", "save_document"],
    DOCUMENT_CREATE_HELP,
  );
}

async function updateDocumentCommand(args, runtime) {
  const parsed = parseFlags(args, {
    command: "documents update",
    value: [...DOCUMENT_FIELDS, "id", "content-file"],
  });
  if (parsed.help) return documentUpdateHelp();
  requireValue(parsed.id, "updating a document requires --id", DOCUMENT_UPDATE_HELP);
  const toolArgs = { id: parsed.id, ...(await documentToolArgs(parsed, runtime)) };
  if (Object.keys(toolArgs).length === 1) {
    throw usage("documents update needs at least one field to change", [
      commandHelp("documents update"),
    ]);
  }
  await ensureDocumentExists(toolArgs.id, runtime);
  return saveDocument(
    toolArgs,
    runtime,
    ["update_document", "save_document"],
    [
      `Run \`linear-axi documents view ${formatCommandArg(toolArgs.id)}\` to check the current values`,
      commandHelp("documents update"),
    ],
  );
}

async function documentToolArgs(parsed, runtime) {
  const toolArgs = collectKnownArgs(parsed, DOCUMENT_FIELDS);
  await applyTextFileFlag(toolArgs, parsed, {
    flag: "content-file",
    field: "content",
    cwd: runtime.cwd,
  });
  return toolArgs;
}

async function saveDocument(toolArgs, runtime, toolNames, help) {
  return runMutation(runtime, {
    toolNames,
    args: toolArgs,
    team: toolArgs.team,
    help,
    render: (document) => ({ document: compactDocumentMutation(document) }),
  });
}
