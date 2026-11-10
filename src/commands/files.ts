import { parseFlags, usage } from "../args.ts";
import { dispatchCommandGroup } from "../lib/cli-helpers.ts";
import { readUploadFiles, uploadFiles } from "../lib/file-upload.ts";
import { fileUploadHelp, groupHelp } from "./help.ts";

const FILE_UPLOAD_HELP = ["Run `linear-axi files upload <path>...`"];

export async function fileCommand(args, runtime) {
  const help = () => groupHelp("files", ["upload"]);
  // Other groups default to `list`, but there is nothing to list here, so a bare `files`
  // shows the subcommands instead of an error.
  if (args.length === 0) return help();
  return dispatchCommandGroup(args, {
    name: "files",
    help,
    handlers: {
      upload: (rest) => uploadFilesCommand(rest, runtime),
    },
    unknownHelp: FILE_UPLOAD_HELP,
  });
}

async function uploadFilesCommand(args, runtime) {
  const parsed = parseFlags(args, {
    command: "files upload",
    positionals: Number.POSITIVE_INFINITY,
  });
  if (parsed.help) return fileUploadHelp();
  if (parsed.positionals.length === 0) {
    throw usage("files upload requires at least one file path", FILE_UPLOAD_HELP);
  }
  const files = await readUploadFiles(parsed.positionals, runtime.cwd, parsed);
  const uploads = await uploadFiles(runtime, files);
  return {
    count: uploads.length,
    files: uploads.map(({ path, contentType, size, assetUrl }) => ({
      path,
      contentType,
      size,
      assetUrl,
    })),
    markdown: uploads.map((upload) => upload.markdown).join("\n"),
    help: [
      "Put markdown in a --body-file or --description-file, or use --attach on comments create, issues create, or issues update",
    ],
  };
}
