import { readFile, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, resolve } from "node:path";
import { commandHelp, operationError, usage } from "../args.ts";
import { callToolData } from "./mcp-tools.ts";
import type { ParsedFlags, Runtime } from "../types.ts";

export const PREPARE_UPLOAD_TOOL = "prepare_file_upload";

// Linear rejects uploads of 2 GB or more; checking locally names the file instead of failing
// after earlier files were already uploaded.
const MAX_UPLOAD_BYTES = 2 * 1024 ** 3;

// A short table covers what agents actually attach (screenshots, logs, reports) without adding
// a MIME dependency; anything else uploads as a generic binary.
const CONTENT_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".log": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
  ".html": "text/html",
  ".zip": "application/zip",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
};

export interface LocalUploadFile {
  path: string;
  filename: string;
  contentType: string;
  bytes: Buffer;
}

export interface UploadedFile {
  path: string;
  filename: string;
  contentType: string;
  size: number;
  assetUrl: string;
  markdown: string;
}

// Files are read up front so a wrong path fails before any Linear lookup or write, matching the
// offline-first validation the text file flags already use.
export async function readUploadFiles(
  paths: string[],
  cwd: string,
  parsed: ParsedFlags,
): Promise<LocalUploadFile[]> {
  const files: LocalUploadFile[] = [];
  for (const path of paths) {
    const absolute = isAbsolute(path) ? path : resolve(cwd, path);
    const help = ["Rerun with a readable file path", commandHelp(parsed.command)];
    let info;
    try {
      info = await stat(absolute);
    } catch {
      throw usage(`file could not be read: ${path}`, help);
    }
    if (!info.isFile()) throw usage(`not a regular file: ${path}`, help);
    if (info.size === 0) throw usage(`file is empty: ${path}`, help);
    if (info.size >= MAX_UPLOAD_BYTES) throw usage(`file must be smaller than 2 GB: ${path}`, help);
    let bytes;
    try {
      bytes = await readFile(absolute);
    } catch {
      throw usage(`file could not be read: ${path}`, help);
    }
    const filename = basename(absolute);
    files.push({ path, filename, contentType: contentTypeFor(filename), bytes });
  }
  return files;
}

export async function uploadFiles(
  runtime: Runtime,
  files: LocalUploadFile[],
): Promise<UploadedFile[]> {
  if (files.length === 0) return [];
  await ensureUploadTool(runtime);
  const uploaded: UploadedFile[] = [];
  // Signed upload URLs expire after 60 seconds, so each file is prepared and sent before the
  // next one is prepared; preparing all of them first lets later URLs expire mid-batch.
  for (const file of files) {
    uploaded.push(await uploadFile(runtime, file, uploaded.length));
  }
  return uploaded;
}

export function appendUploadMarkdown(text: string | null | undefined, uploads: UploadedFile[]) {
  const markdown = uploads.map((upload) => upload.markdown).join("\n\n");
  const base = String(text ?? "").replace(/\s+$/, "");
  return base ? `${base}\n\n${markdown}` : markdown;
}

export function uploadSummary(uploads: UploadedFile[]) {
  return uploads.map(({ path, assetUrl }) => ({ path, assetUrl }));
}

async function ensureUploadTool(runtime: Runtime) {
  if (typeof runtime.client.listTools !== "function") return;
  const tools = await runtime.client.listTools();
  // An empty list means the server did not report tools; let the call itself decide then.
  if (tools.length > 0 && !tools.some((tool) => tool.name === PREPARE_UPLOAD_TOOL)) {
    throw operationError(`Linear MCP server at ${runtime.mcpUrl} does not support file uploads`, [
      "Unset LINEAR_AXI_MCP_URL to use https://mcp.linear.app/mcp, which supports uploads",
    ]);
  }
}

async function uploadFile(runtime: Runtime, file: LocalUploadFile, alreadyUploaded: number) {
  const prepared = await callToolData(runtime, PREPARE_UPLOAD_TOOL, {
    filename: file.filename,
    contentType: file.contentType,
    size: file.bytes.length,
  });
  const request = prepared?.uploadRequest;
  if (typeof request?.url !== "string" || typeof prepared?.assetUrl !== "string") {
    throw operationError(`Linear did not return an upload URL for ${file.path}`, [
      ...orphanHelp(alreadyUploaded),
      "Rerun the command",
    ]);
  }

  let response;
  try {
    response = await (runtime.fetch ?? fetch)(request.url, {
      method: request.method ?? "PUT",
      // The headers are part of the URL signature; they must go out unchanged or storage
      // answers 403.
      headers: normalizeHeaders(request.headers),
      // readFile never returns a SharedArrayBuffer-backed Buffer; the cast only narrows the type
      // so the bytes go out as-is without a copy.
      body: file.bytes as Uint8Array<ArrayBuffer>,
    });
  } catch {
    throw operationError(`upload of ${file.path} failed: could not reach Linear file storage`, [
      ...orphanHelp(alreadyUploaded),
      "Check network access and rerun the command",
    ]);
  }
  if (!response.ok) {
    throw operationError(`upload of ${file.path} failed (HTTP ${response.status})`, [
      ...orphanHelp(alreadyUploaded),
      "Rerun the command; signed upload URLs expire after 60 seconds",
    ]);
  }

  return {
    path: file.path,
    filename: file.filename,
    contentType: file.contentType,
    size: file.bytes.length,
    assetUrl: prepared.assetUrl,
    markdown:
      typeof prepared.markdown === "string" && prepared.markdown
        ? prepared.markdown
        : markdownFor(file, prepared.assetUrl),
  };
}

// Linear MCP cannot delete stored files, so a partial batch is reported instead of implying a
// rollback happened.
function orphanHelp(alreadyUploaded: number) {
  if (alreadyUploaded === 0) return [];
  const files =
    alreadyUploaded === 1 ? "1 earlier file was" : `${alreadyUploaded} earlier files were`;
  return [`${files} uploaded but not added to Linear; nothing was saved`];
}

function normalizeHeaders(headers): Record<string, string> {
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers.map((header) => [header.key, String(header.value)]));
  }
  if (headers && typeof headers === "object") {
    return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, String(value)]));
  }
  return {};
}

function markdownFor(file: LocalUploadFile, assetUrl: string) {
  const label = file.filename.replace(/[[\]]/g, "\\$&");
  return file.contentType.startsWith("image/")
    ? `![${label}](${assetUrl})`
    : `[${label}](${assetUrl})`;
}

function contentTypeFor(filename: string) {
  return CONTENT_TYPES[extname(filename).toLowerCase()] ?? "application/octet-stream";
}
