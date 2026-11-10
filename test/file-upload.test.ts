import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { decode } from "@toon-format/toon";
import { main } from "../src/cli.ts";

const PNG = Buffer.from("89504e470d0a1a0a", "hex");
const SIGNED_HEADERS = {
  "content-type": "image/png",
  "cache-control": "public, max-age=31536000",
  "x-goog-content-length-range": "8,8",
  "Content-Disposition": 'attachment; filename="shot.png"',
};

test("files upload prepares, PUTs signed headers verbatim, and prints markdown", async () => {
  const dir = await fixtureDir();
  const linear = fakeLinear();

  const result = await cli(["files", "upload", "shot.png", "trace.log"], { cwd: dir, linear });

  assert.equal(result.exitCode, 0, result.output);
  assert.deepEqual(linear.prepares, [
    { filename: "shot.png", contentType: "image/png", size: PNG.length },
    { filename: "trace.log", contentType: "text/plain", size: 5 },
  ]);
  assert.equal(linear.puts.length, 2);
  assert.equal(linear.puts[0].method, "PUT");
  assert.deepEqual(linear.puts[0].headers, SIGNED_HEADERS);
  assert.deepEqual(Buffer.from(linear.puts[0].body), PNG);
  const output = decode(result.output) as any;
  assert.equal(output.count, 2);
  assert.equal(output.files[0].assetUrl, "https://uploads.linear.app/asset-1");
  assert.equal(
    output.markdown,
    "![shot.png](https://uploads.linear.app/asset-1)\n![trace.log](https://uploads.linear.app/asset-2)",
  );
});

test("files upload finishes each PUT before preparing the next file", async () => {
  const dir = await fixtureDir();
  const events = [];
  const linear = fakeLinear({ events });

  await cli(["files", "upload", "shot.png", "trace.log"], { cwd: dir, linear });

  assert.deepEqual(events, ["prepare shot.png", "put", "prepare trace.log", "put"]);
});

test("files upload builds markdown when Linear omits it", async () => {
  const dir = await fixtureDir();
  const linear = fakeLinear({ omitMarkdown: true });

  const result = await cli(["files", "upload", "shot.png", "trace.log"], { cwd: dir, linear });

  assert.equal(
    (decode(result.output) as any).markdown,
    "![shot.png](https://uploads.linear.app/asset-1)\n[trace.log](https://uploads.linear.app/asset-2)",
  );
});

test("files upload accepts headers as a key/value list", async () => {
  const dir = await fixtureDir();
  const linear = fakeLinear({
    headers: [{ key: "content-type", value: "image/png" }],
  });

  await cli(["files", "upload", "shot.png"], { cwd: dir, linear });

  assert.deepEqual(linear.puts[0].headers, { "content-type": "image/png" });
});

test("files upload fails on a missing file before any Linear call", async () => {
  const dir = await fixtureDir();
  const linear = fakeLinear();

  const result = await cli(["files", "upload", "shot.png", "nope.png"], { cwd: dir, linear });

  assert.equal(result.exitCode, 2, result.output);
  assert.match(result.output, /file could not be read: nope.png/);
  assert.deepEqual(linear.calls, []);
  assert.equal(linear.puts.length, 0);
});

test("files upload rejects empty files", async () => {
  const dir = await fixtureDir();
  await writeFile(join(dir, "empty.png"), "");

  const result = await cli(["files", "upload", "empty.png"], { cwd: dir, linear: fakeLinear() });

  assert.equal(result.exitCode, 2, result.output);
  assert.match(result.output, /file is empty: empty.png/);
});

test("files upload explains when the MCP server has no upload tool", async () => {
  const dir = await fixtureDir();
  const linear = fakeLinear({ tools: ["get_issue", "save_comment"] });

  const result = await cli(["files", "upload", "shot.png"], { cwd: dir, linear });

  assert.equal(result.exitCode, 1, result.output);
  assert.match(result.output, /does not support file uploads/);
  assert.match(result.output, /LINEAR_AXI_MCP_URL/);
  assert.equal(linear.puts.length, 0);
});

test("a rejected PUT reports earlier orphaned uploads and saves nothing", async () => {
  const dir = await fixtureDir();
  const linear = fakeLinear({ putStatuses: [200, 403] });

  const result = await cli(
    ["comments", "create", "--issue", "LIN-1", "--attach", "shot.png", "--attach", "trace.log"],
    { cwd: dir, linear },
  );

  assert.equal(result.exitCode, 1, result.output);
  assert.match(result.output, /upload of trace.log failed \(HTTP 403\)/);
  assert.match(result.output, /1 earlier file was uploaded but not added to Linear/);
  assert.ok(!linear.calls.some((call) => call.name === "save_comment"));
});

test("files without a subcommand shows group help", async () => {
  const result = await cli(["files"], { linear: fakeLinear() });

  assert.equal(result.exitCode, 0, result.output);
  assert.match(result.output, /usage: linear-axi files <subcommand>/);
  assert.match(result.output, /upload/);
});

test("comments create --attach appends image markdown to the body", async () => {
  const dir = await fixtureDir();
  const linear = fakeLinear();

  const result = await cli(
    ["comments", "create", "--issue", "LIN-1", "--body", "Broken  \n", "--attach", "shot.png"],
    { cwd: dir, linear },
  );

  assert.equal(result.exitCode, 0, result.output);
  assert.equal(
    linear.saved("save_comment").body,
    "Broken\n\n![shot.png](https://uploads.linear.app/asset-1)",
  );
  assert.deepEqual((decode(result.output) as any).attachments, [
    { path: "shot.png", assetUrl: "https://uploads.linear.app/asset-1" },
  ]);
});

test("comments create accepts --attach without a body", async () => {
  const dir = await fixtureDir();
  const linear = fakeLinear();

  const result = await cli(["comments", "create", "--issue", "LIN-1", "--attach", "shot.png"], {
    cwd: dir,
    linear,
  });

  assert.equal(result.exitCode, 0, result.output);
  assert.equal(
    linear.saved("save_comment").body,
    "![shot.png](https://uploads.linear.app/asset-1)",
  );
});

test("comments create checks the issue before uploading", async () => {
  const dir = await fixtureDir();
  const linear = fakeLinear({ issue: null });

  const result = await cli(["comments", "create", "--issue", "LIN-9", "--attach", "shot.png"], {
    cwd: dir,
    linear,
  });

  assert.equal(result.exitCode, 1, result.output);
  assert.match(result.output, /issue not found: LIN-9/);
  assert.deepEqual(linear.prepares, []);
});

test("issues create --attach appends to the description", async () => {
  const dir = await fixtureDir();
  const linear = fakeLinear();

  const result = await cli(
    [
      "issues",
      "create",
      "--title",
      "Dark mode",
      "--team",
      "ENG",
      "--description",
      "Half rendered",
      "--attach",
      "shot.png",
    ],
    { cwd: dir, linear },
  );

  assert.equal(result.exitCode, 0, result.output);
  assert.equal(
    linear.saved("save_issue").description,
    "Half rendered\n\n![shot.png](https://uploads.linear.app/asset-1)",
  );
});

test("issues create returning an existing issue uploads nothing and points at update", async () => {
  const dir = await fixtureDir();
  const linear = fakeLinear({ existing: { identifier: "LIN-5", title: "Dark mode", team: "ENG" } });

  const result = await cli(
    ["issues", "create", "--title", "Dark mode", "--team", "ENG", "--attach", "shot.png"],
    { cwd: dir, linear },
  );

  assert.equal(result.exitCode, 0, result.output);
  assert.match(result.output, /existing: true/);
  assert.match(result.output, /linear-axi issues update --id LIN-5 --attach shot.png/);
  assert.match(result.output, /--allow-duplicate/);
  assert.deepEqual(linear.prepares, []);
});

test("issues update --attach appends to the current description", async () => {
  const dir = await fixtureDir();
  const linear = fakeLinear({ issue: { identifier: "LIN-1", description: "Steps to reproduce" } });

  const result = await cli(["issues", "update", "--id", "LIN-1", "--attach", "shot.png"], {
    cwd: dir,
    linear,
  });

  assert.equal(result.exitCode, 0, result.output);
  assert.deepEqual(linear.saved("save_issue"), {
    id: "LIN-1",
    description: "Steps to reproduce\n\n![shot.png](https://uploads.linear.app/asset-1)",
  });
});

test("issues update --attach appends to a new description when one is given", async () => {
  const dir = await fixtureDir();
  const linear = fakeLinear({ issue: { identifier: "LIN-1", description: "Old" } });

  await cli(["issues", "update", "--id", "LIN-1", "--description", "New", "--attach", "shot.png"], {
    cwd: dir,
    linear,
  });

  assert.equal(
    linear.saved("save_issue").description,
    "New\n\n![shot.png](https://uploads.linear.app/asset-1)",
  );
});

test("issues update --attach refuses when the current description is unknown", async () => {
  const dir = await fixtureDir();
  const linear = fakeLinear({ issue: { identifier: "LIN-1", title: "No description field" } });

  const result = await cli(["issues", "update", "--id", "LIN-1", "--attach", "shot.png"], {
    cwd: dir,
    linear,
  });

  assert.equal(result.exitCode, 1, result.output);
  assert.match(result.output, /could not read the current description of LIN-1/);
  assert.deepEqual(linear.prepares, []);
  assert.ok(!linear.calls.some((call) => call.name === "save_issue"));
});

test("issues update --attach treats a null description as empty", async () => {
  const dir = await fixtureDir();
  const linear = fakeLinear({ issue: { identifier: "LIN-1", description: null } });

  await cli(["issues", "update", "--id", "LIN-1", "--attach", "shot.png"], { cwd: dir, linear });

  assert.equal(
    linear.saved("save_issue").description,
    "![shot.png](https://uploads.linear.app/asset-1)",
  );
});

async function fixtureDir() {
  const dir = await mkdtemp(join(tmpdir(), "linear-axi-upload-"));
  await writeFile(join(dir, "shot.png"), PNG);
  await writeFile(join(dir, "trace.log"), "hello");
  return dir;
}

// One fake stands in for both sides of an upload: MCP tool calls and the signed-URL PUT.
function fakeLinear(options: any = {}) {
  const calls = [];
  const prepares = [];
  const puts = [];
  const events = options.events ?? [];
  const putStatuses = [...(options.putStatuses ?? [])];
  const tools = options.tools ?? [
    "get_issue",
    "list_issues",
    "save_issue",
    "save_comment",
    "prepare_file_upload",
  ];
  const issue =
    "issue" in options ? options.issue : { identifier: "LIN-1", title: "Task", description: "" };
  const json = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });

  return {
    calls,
    prepares,
    puts,
    saved: (name) => calls.findLast((call) => call.name === name)?.args,
    client: {
      close: async () => {},
      listTools: async () => tools.map((name) => ({ name })),
      callTool: async (name, args) => {
        calls.push({ name, args });
        if (name === "prepare_file_upload") {
          prepares.push(args);
          events.push(`prepare ${args.filename}`);
          const assetUrl = `https://uploads.linear.app/asset-${prepares.length}`;
          return json({
            assetUrl,
            ...(options.omitMarkdown ? {} : { markdown: `![${args.filename}](${assetUrl})` }),
            uploadRequest: {
              method: "PUT",
              url: `https://storage.example/upload-${prepares.length}?sig=secret`,
              headers: options.headers ?? SIGNED_HEADERS,
            },
          });
        }
        if (name === "get_issue") {
          if (!issue)
            return { isError: true, content: [{ type: "text", text: "Issue not found" }] };
          return { structuredContent: issue };
        }
        if (name === "list_issues") {
          return { structuredContent: { issues: options.existing ? [options.existing] : [] } };
        }
        if (name === "save_issue") return { structuredContent: { identifier: "LIN-1", ...args } };
        if (name === "save_comment") return { structuredContent: { id: "c1", ...args } };
        return { structuredContent: {} };
      },
    },
    fetch: async (url, init) => {
      events.push("put");
      puts.push({ url, ...init });
      const status = putStatuses.shift() ?? 200;
      return new Response("", { status });
    },
  };
}

async function cli(args, { cwd = process.cwd(), linear }) {
  const stdout = [];
  const originalExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    await main(args, {
      cwd,
      env: { LINEAR_AXI_MCP_URL: "https://mcp.linear.app/mcp" },
      stdout: { write: (text) => stdout.push(text) },
      stderr: { write: () => {} },
      client: linear.client,
      fetch: linear.fetch as typeof fetch,
    });
    return { output: stdout.join(""), exitCode: process.exitCode ?? 0 };
  } finally {
    process.exitCode = originalExitCode;
  }
}
