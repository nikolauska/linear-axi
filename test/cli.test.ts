import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { decode } from "@toon-format/toon";
import { main } from "../src/cli.ts";

const packageVersion = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

test("top help exposes Linear resource commands", async () => {
  const output = await ok(["--help"], runtime({}));

  assert.match(
    output,
    /issues, projects, teams, users, comments, documents, milestones, cycles, statuses, labels/,
  );
  assert.doesNotMatch(output, /releases/);
  assert.doesNotMatch(output, /statuses save/);
  assert.doesNotMatch(output, /statuses delete/);
  assert.doesNotMatch(output, /tools list/);
  assert.doesNotMatch(output, /call <tool>/);
});

test("main top help includes SDK update built-in", async () => {
  const output = await ok(["--help"]);

  assert.match(output, /flags\[3\]:/);
  assert.match(output, /-v\/-V\/--version/);
  assert.match(output, /"built-in":/);
  assert.match(output, /"update --check": Report current vs latest without installing/);
});

test("main top-level -h alias renders SDK help", async () => {
  const output = await ok(["-h"]);

  assert.match(output, /^usage: linear-axi \[command\]/);
  assert.match(output, /"built-in":/);
  assert.doesNotMatch(output, /Flags must come after the command/);
});

test("main home uses SDK CLI description header", async () => {
  const output = await ok([], {
    cwd: (await makeNoGitTempDir()) ?? process.cwd(),
    client: {
      close: async () => {},
      listTools: async () => [{ name: "list_teams" }],
      callTool: async () => ({ structuredContent: { teams: [{ workspace: { name: "Acme" } }] } }),
    },
  });

  assert.match(
    output,
    /description: Agent ergonomic wrapper around the configured Linear MCP server/,
  );
  assert.doesNotMatch(output, /description: Linear project dashboard/);
});

test("main prints package version flags", async () => {
  for (const flag of ["-v", "-V", "--version"]) {
    assert.equal(await ok([flag]), `${packageVersion.version}\n`);
  }
});

test("main exposes update check help without resolving Linear context", async () => {
  let called = false;
  const output = await ok(["update", "--help"], {
    client: {
      close: async () => {},
      callTool: async () => {
        called = true;
        return {};
      },
    },
  });

  assert.equal(called, false);
  assert.match(output, /command: update/);
  assert.match(output, /"--check": Report current vs latest and exit without installing/);
  assert.match(output, /update --check/);
});

test("home uninitialized repo suggests project setup without global issue count", async () => {
  const parent = await mkdtemp(join(tmpdir(), "linear-axi-home-"));
  const repo = join(parent, "linear-axi");
  await mkdir(join(repo, ".git"), { recursive: true });
  let issueListCalled = false;

  const output = await ok(
    [],
    runtime({
      cwd: repo,
      listTools: async () => [{ name: "list_teams" }, { name: "list_issues" }],
      callTool: async (name) => {
        if (name === "list_teams")
          return { structuredContent: { teams: [{ workspace: { name: "Acme" } }] } };
        issueListCalled = true;
        return { structuredContent: { issues: [{ identifier: "LIN-1", title: "Global issue" }] } };
      },
    }),
  );

  assert.equal(issueListCalled, false);
  assert.match(output, /workspace: Acme\nproject: not initialized\nrepo: linear-axi/);
  assert.match(output, /status: No default Linear project is configured for this repository/);
  assert.match(output, /linear-axi init --project/);
  assert.match(output, /linear-axi issues list --assignee me --all-projects/);
  assert.doesNotMatch(output, /assigned to me$/m);
  assert.doesNotMatch(output, /Global issue/);
});

test("home does not use project row names as workspace names", async () => {
  const repo = await mkdtemp(join(tmpdir(), "linear-axi-repo-"));
  await mkdir(join(repo, ".git"));

  const output = await ok(
    [],
    runtime({
      cwd: repo,
      listTools: async () => [{ name: "list_projects" }],
      callTool: async () => ({ structuredContent: { projects: [{ name: "Roadmap" }] } }),
    }),
  );

  assert.match(output, /workspace: unknown\nproject: not initialized/);
  assert.doesNotMatch(output, /workspace: Roadmap/);
});

test("home derives workspace names from Linear project URLs", async () => {
  const repo = await mkdtemp(join(tmpdir(), "linear-axi-repo-"));
  await mkdir(join(repo, ".git"));

  const output = await ok(
    [],
    runtime({
      cwd: repo,
      listTools: async () => [{ name: "list_projects" }],
      callTool: async () => ({
        structuredContent: {
          projects: [{ name: "Roadmap", url: "https://linear.app/acme/project/roadmap" }],
        },
      }),
    }),
  );

  assert.match(output, /workspace: acme\nproject: not initialized/);
});

test("home auth errors suggest login before list commands for initialized repos", async () => {
  const parent = await mkdtemp(join(tmpdir(), "linear-axi-home-"));
  const repo = join(parent, "linear-axi");
  await mkdir(join(repo, ".git"), { recursive: true });
  await writeFile(join(repo, ".linear-project"), JSON.stringify({ project: "Roadmap" }), "utf8");

  const output = await ok(
    [],
    runtime({
      cwd: repo,
      listTools: async () => [{ name: "list_teams" }, { name: "list_issues" }],
      callTool: async (name) => {
        if (name === "list_teams")
          return { structuredContent: { teams: [{ workspace: { name: "Acme" } }] } };
        const error = new Error("auth required");
        error.authorizationUrl = "https://linear.example/authorize?state=expected-state";
        throw error;
      },
    }),
  );

  assert.match(output, /workspace: Acme\nproject: Roadmap\n/);
  assert.match(output, /status: Linear MCP connection unavailable/);
  assert.match(output, /error: Linear MCP OAuth authorization required/);
  assert.match(output, /Run `linear-axi auth login`/);
  assert.doesNotMatch(output, /linear-axi init --project/);
  assert.doesNotMatch(output, /issues list --assignee me --limit 50/);
});

test("home project uses .linear-project when configured", async () => {
  const repo = await mkdtemp(join(tmpdir(), "linear-axi-repo-"));
  await mkdir(join(repo, ".git"));
  await writeFile(join(repo, ".linear-project"), JSON.stringify({ project: "Roadmap" }), "utf8");

  const output = await ok(
    [],
    runtime({
      cwd: repo,
      listTools: async () => [{ name: "list_teams" }, { name: "list_issues" }],
      callTool: async (name) => {
        if (name === "list_teams")
          return { structuredContent: { teams: [{ workspace: { name: "Acme" } }] } };
        return { structuredContent: { issues: [] } };
      },
    }),
  );

  assert.match(output, /workspace: Acme\nproject: Roadmap\nrepo: /);
  assert.match(output, /issues: 0 assigned to me in project/);
  assert.doesNotMatch(output, /issues\[0\]/);
});

test("home warns when configured project is not in the current workspace", async () => {
  const repo = await mkdtemp(join(tmpdir(), "linear-axi-repo-"));
  await mkdir(join(repo, ".git"));
  await writeFile(
    join(repo, ".linear-project"),
    JSON.stringify({ workspace: "Acme", project: "Linear AXI" }),
    "utf8",
  );
  let issueListCalled = false;

  const output = await ok(
    [],
    runtime({
      cwd: repo,
      listTools: async () => [{ name: "list_projects" }, { name: "list_issues" }],
      callTool: async (name, args) => {
        if (name === "list_projects" && !args.query) {
          return {
            structuredContent: {
              projects: [{ name: "Roadmap", url: "https://linear.app/acme/project/roadmap" }],
            },
          };
        }
        if (name === "list_projects") return { structuredContent: { projects: [] } };
        issueListCalled = true;
        return { structuredContent: { issues: [] } };
      },
    }),
  );

  assert.equal(issueListCalled, false);
  assert.match(output, /workspace: acme\nproject: Linear AXI\n/);
  assert.match(output, /status: Default Linear project is invalid/);
  assert.match(
    output,
    /error: "The saved default Linear project does not exist in the authenticated workspace: Linear AXI"/,
  );
  assert.match(
    output,
    /Run `linear-axi projects list --query 'Linear AXI' --fields id,name,status` to search the current workspace/,
  );
  assert.match(output, /linear-axi init --project \\"<project>\\" --force/);
});

test("home summarizes project-assigned issues instead of listing rows", async () => {
  const repo = await mkdtemp(join(tmpdir(), "linear-axi-repo-"));
  await mkdir(join(repo, ".git"));
  await writeFile(join(repo, ".linear-project"), JSON.stringify({ project: "Roadmap" }), "utf8");

  const output = await ok(
    [],
    runtime({
      cwd: repo,
      listTools: async () => [{ name: "list_teams" }, { name: "list_issues" }],
      callTool: async (name) => {
        if (name === "list_teams")
          return { structuredContent: { teams: [{ workspace: { name: "Acme" } }] } };
        return {
          structuredContent: {
            issues: [
              { identifier: "LIN-1", title: "Fix auth" },
              { identifier: "LIN-2", title: "Ship docs" },
            ],
            cursor: "next-page",
          },
        };
      },
    }),
  );

  assert.match(output, /issues: 2\+ assigned to me in project/);
  assert.doesNotMatch(output, /issues\[2\]/);
  assert.doesNotMatch(output, /Fix auth/);
});

test("empty lists render as gh-axi-style empty arrays", async () => {
  const output = await ok(
    ["projects", "list"],
    runtime({
      callTool: async () => ({ structuredContent: { projects: [] } }),
    }),
  );

  assert.match(output, /count: 0 returned/);
  assert.match(output, /projects: \[\]/);
  assert.match(output, /Run `linear-axi projects create --name/);
  assert.doesNotMatch(output, /0 projects found/);
  assert.doesNotMatch(output, /--fields/);
});

test("empty list continuation hints do not leak across calls", async () => {
  let calls = 0;
  const client = runtime({
    callTool: async () => {
      calls += 1;
      return calls === 1
        ? { structuredContent: { projects: [], cursor: "next-page" } }
        : { structuredContent: { projects: [] } };
    },
  });

  const firstOutput = await ok(["projects", "list"], client);
  const secondOutput = await ok(["projects", "list"], client);

  assert.match(firstOutput, /--cursor next-page/);
  assert.doesNotMatch(secondOutput, /--cursor next-page/);
  assert.match(secondOutput, /help\[1\]:/);
});

test("projects list uses list_projects wrapper", async () => {
  let seen;
  const output = await ok(
    ["projects", "list", "--query", "roadmap"],
    runtime({
      callTool: async (name, args) => {
        seen = { name, args };
        return {
          structuredContent: {
            projects: [
              { id: "p-backlog", name: "Later", state: "Backlog" },
              { id: "p-progress", name: "Roadmap", state: "In Progress" },
              { id: "p-planned", name: "Next", state: "Planned" },
            ],
          },
        };
      },
    }),
  );

  assert.deepEqual(seen, { name: "list_projects", args: { query: "roadmap", limit: 50 } });
  assert.match(
    output,
    /projects\[3\]\{status,name,id\}:\n  In Progress,Roadmap,p-progress\n  Planned,Next,p-planned\n  Backlog,Later,p-backlog/,
  );
  assert.doesNotMatch(output, /help/);
  assert.doesNotMatch(output, /--full/);
  assert.doesNotMatch(output, /--query "<text>"/);
});

test("list commands support fields and pagination hints", async () => {
  const output = await ok(
    ["projects", "list", "--fields", "id,name,state", "--query", "roadmap", "--limit", "25"],
    runtime({
      callTool: async () => ({
        structuredContent: {
          projects: [{ id: "p1", name: "Roadmap", state: "started", ignored: "hidden" }],
          hasNextPage: true,
          cursor: "next-page",
        },
      }),
    }),
  );

  assert.match(output, /count: 1 returned \(more available\)/);
  assert.match(output, /cursor: next-page/);
  assert.match(output, /projects\[1\]\{id,name,state\}:/);
  assert.match(output, /p1,Roadmap,started/);
  assert.doesNotMatch(output, /ignored/);
  assert.doesNotMatch(output, /help\[\d+\]:.*choose fields/);
  assert.match(
    output,
    /Run `linear-axi projects list --limit 25 --query roadmap --fields 'id,name,state' --cursor next-page` to continue/,
  );
});

test("list pagination hints shell-escape unsafe values", async () => {
  const output = await ok(
    ["projects", "list", "--query", "roadmap $(touch /tmp/axi)'$HOME", "--limit", "25"],
    runtime({
      callTool: async () => ({
        structuredContent: {
          projects: [{ id: "p1", name: "Roadmap" }],
          cursor: "next $(touch /tmp/cursor)'$TOKEN",
        },
      }),
    }),
  );

  assert.match(output, /cursor: next \$\(touch \/tmp\/cursor\)'\$TOKEN/);
  assert.deepEqual(decode(output).help, [
    "Run `linear-axi projects list --limit 25 --query 'roadmap $(touch /tmp/axi)'\\''$HOME' --cursor 'next $(touch /tmp/cursor)'\\''$TOKEN'` to continue",
  ]);
});

test("list pagination hints are emitted for cursor-only responses", async () => {
  const output = await ok(
    ["projects", "list", "--limit", "25"],
    runtime({
      callTool: async () => ({
        structuredContent: {
          projects: [{ id: "p1", name: "Roadmap" }],
          pageInfo: { endCursor: "next-page" },
        },
      }),
    }),
  );

  assert.match(output, /count: 1 returned \(more available\)/);
  assert.match(output, /cursor: next-page/);
  assert.match(output, /Run `linear-axi projects list --limit 25 --cursor next-page` to continue/);
});

test("list pagination hints preserve false boolean filters", async () => {
  const output = await ok(
    ["projects", "list", "--limit", "25", "--includeArchived=false", "--full=false"],
    runtime({
      callTool: async () => ({
        structuredContent: {
          projects: [{ id: "p1", name: "Roadmap" }],
          pageInfo: { hasNextPage: true, endCursor: "next-page" },
        },
      }),
    }),
  );

  assert.match(
    output,
    /Run `linear-axi projects list --limit 25 --includeArchived=false --full=false --cursor next-page` to continue/,
  );
  assert.doesNotMatch(output, /--includeArchived false/);
  assert.doesNotMatch(output, /--full false/);
});

test("list full counts rows inside response envelopes", async () => {
  const output = await ok(
    ["projects", "list", "--full"],
    runtime({
      callTool: async () => ({
        structuredContent: {
          projects: [
            { id: "p1", name: "Roadmap" },
            { id: "p2", name: "Inbox" },
          ],
        },
      }),
    }),
  );

  assert.match(output, /count: 2 returned/);
  assert.match(output, /projects\[2\]\{id,name\}:/);
});

test("issues list requires project scope or all-projects in uninitialized repos", async () => {
  const repo = await mkdtemp(join(tmpdir(), "linear-axi-repo-"));
  await mkdir(join(repo, ".git"));
  let called = false;

  const output = expectFailure(
    await cli(
      ["issues", "list", "--assignee", "me"],
      runtime({
        cwd: repo,
        callTool: async () => {
          called = true;
          return {};
        },
      }),
    ),
    2,
    /No default Linear project is configured for this repository/,
  );
  assert.match(output, /code: VALIDATION_ERROR/);
  assert.match(output, /linear-axi issues list --all-projects/);

  assert.equal(called, false);
});

test("issues list uses list_issues wrapper with explicit all-projects", async () => {
  let seen;
  const output = await ok(
    ["issues", "list", "--assignee", "me", "--all-projects"],
    runtime({
      callTool: async (name, args) => {
        seen = { name, args };
        return {
          structuredContent: {
            issues: [
              {
                identifier: "LIN-2",
                title: "Write docs",
                state: { name: "Todo" },
                assignee: { name: "Morris" },
              },
              {
                identifier: "LIN-1",
                title: "Fix auth",
                state: { name: "In Progress" },
                assignee: { name: "Morris" },
              },
              {
                identifier: "LIN-3",
                title: "Plan release",
                state: { name: "Planned" },
                assignee: { name: "Morris" },
              },
            ],
          },
        };
      },
    }),
  );

  assert.deepEqual(seen, { name: "list_issues", args: { assignee: "me", limit: 50 } });
  assert.match(
    output,
    /issues\[3\]\{state,title,assignee,id\}:\n  In Progress,Fix auth,Morris,LIN-1\n  Planned,Plan release,Morris,LIN-3\n  Todo,Write docs,Morris,LIN-2/,
  );
});

test("all-projects bypasses repo default project for issue lists", async () => {
  const repo = await mkdtemp(join(tmpdir(), "linear-axi-repo-"));
  await mkdir(join(repo, ".git"));
  await writeFile(
    join(repo, ".linear-project"),
    `${JSON.stringify({ project: "Roadmap" })}\n`,
    "utf8",
  );

  let seen;
  await ok(
    ["issues", "list", "--assignee", "me", "--all-projects"],
    runtime({
      cwd: repo,
      callTool: async (name, args) => {
        seen = { name, args };
        return { structuredContent: { issues: [] } };
      },
    }),
  );

  assert.deepEqual(seen, { name: "list_issues", args: { assignee: "me", limit: 50 } });
});

test("all-projects conflicts with explicit project", async () => {
  expectFailure(
    await cli(["issues", "list", "--project", "Roadmap", "--all-projects"], runtime({})),
    2,
    /--project and --all-projects cannot be used together/,
  );
});

test("documents list requires project scope or all-projects in uninitialized repos", async () => {
  const repo = await mkdtemp(join(tmpdir(), "linear-axi-repo-"));
  await mkdir(join(repo, ".git"));
  let called = false;

  expectFailure(
    await cli(
      ["documents", "list"],
      runtime({
        cwd: repo,
        callTool: async () => {
          called = true;
          return {};
        },
      }),
    ),
    2,
    /No default Linear project is configured for this repository/,
  );

  assert.equal(called, false);
});

test("documents list all-projects bypasses repo default project", async () => {
  const repo = await mkdtemp(join(tmpdir(), "linear-axi-repo-"));
  await mkdir(join(repo, ".git"));
  await writeFile(
    join(repo, ".linear-project"),
    `${JSON.stringify({ project: "Roadmap" })}\n`,
    "utf8",
  );

  let seen;
  await ok(
    ["documents", "list", "--all-projects"],
    runtime({
      cwd: repo,
      callTool: async (name, args) => {
        seen = { name, args };
        return { structuredContent: { documents: [] } };
      },
    }),
  );

  assert.deepEqual(seen, { name: "list_documents", args: { limit: 50 } });
});

test("all-projects is rejected for non project-scoped lists", async () => {
  expectFailure(
    await cli(["projects", "list", "--all-projects"], runtime({})),
    2,
    /unknown flag --all-projects/,
  );
});

test("init saves repo project and issues list uses it by default", async () => {
  const repo = await mkdtemp(join(tmpdir(), "linear-axi-repo-"));
  await mkdir(join(repo, ".git"));

  const initOutput = await ok(["init", "--project", "Roadmap"], runtime({ cwd: repo }));
  assert.match(initOutput, /project: initialized/);
  assert.match(initOutput, /file: .+\.linear-project/);
  assert.doesNotMatch(initOutput, /help\[/);
  assert.deepEqual(JSON.parse(await readFile(join(repo, ".linear-project"), "utf8")), {
    project: "Roadmap",
  });

  let seen;
  await ok(
    ["issues", "list"],
    runtime({
      cwd: repo,
      callTool: async (name, args) => {
        seen = { name, args };
        return { structuredContent: { issues: [] } };
      },
    }),
  );

  assert.deepEqual(seen, { name: "list_issues", args: { project: "Roadmap", limit: 50 } });
});

test("init validates the project and saves the authenticated workspace", async () => {
  const repo = await mkdtemp(join(tmpdir(), "linear-axi-repo-"));
  await mkdir(join(repo, ".git"));

  const initOutput = await ok(
    ["init", "--project", "Roadmap"],
    runtime({
      cwd: repo,
      listTools: async () => [{ name: "list_projects" }],
      callTool: async (name, args) => {
        assert.equal(name, "list_projects");
        assert.deepEqual(args, { query: "Roadmap", limit: 10 });
        return {
          structuredContent: {
            projects: [{ name: "Roadmap", workspace: { name: "Acme" } }],
          },
        };
      },
    }),
  );

  assert.match(initOutput, /workspace: Acme/);
  assert.deepEqual(JSON.parse(await readFile(join(repo, ".linear-project"), "utf8")), {
    workspace: "Acme",
    project: "Roadmap",
  });
});

test("init preserves project ids after validation", async () => {
  const repo = await mkdtemp(join(tmpdir(), "linear-axi-repo-"));
  await mkdir(join(repo, ".git"));

  const initOutput = await ok(
    ["init", "--project", "project-id-1"],
    runtime({
      cwd: repo,
      listTools: async () => [{ name: "list_projects" }],
      callTool: async (name, args) => {
        assert.equal(name, "list_projects");
        assert.deepEqual(args, { query: "project-id-1", limit: 10 });
        return {
          structuredContent: {
            projects: [{ id: "project-id-1", name: "Roadmap", workspace: { name: "Acme" } }],
          },
        };
      },
    }),
  );

  assert.match(initOutput, /workspace: Acme/);
  assert.deepEqual(JSON.parse(await readFile(join(repo, ".linear-project"), "utf8")), {
    workspace: "Acme",
    project: "project-id-1",
  });
});

test("init validates project uuids with get_project when available", async () => {
  const repo = await mkdtemp(join(tmpdir(), "linear-axi-repo-"));
  await mkdir(join(repo, ".git"));
  const projectId = "5bf051dd-8c53-4fd9-a606-58dbeae18ec4";

  const initOutput = await ok(
    ["init", "--project", projectId],
    runtime({
      cwd: repo,
      listTools: async () => [{ name: "get_project" }, { name: "list_projects" }],
      callTool: async (name, args) => {
        assert.equal(name, "get_project");
        assert.deepEqual(args, { query: projectId });
        return {
          structuredContent: {
            id: projectId,
            name: "Roadmap",
            workspace: { name: "Acme" },
          },
        };
      },
    }),
  );

  assert.match(initOutput, /workspace: Acme/);
  assert.deepEqual(JSON.parse(await readFile(join(repo, ".linear-project"), "utf8")), {
    workspace: "Acme",
    project: projectId,
  });
});

test("init force repairs stale workspace metadata for the same project", async () => {
  const repo = await mkdtemp(join(tmpdir(), "linear-axi-repo-"));
  await mkdir(join(repo, ".git"));
  await writeFile(
    join(repo, ".linear-project"),
    JSON.stringify({ workspace: "OldCo", project: "Roadmap" }),
    "utf8",
  );

  const initOutput = await ok(
    ["init", "--project", "Roadmap", "--force"],
    runtime({
      cwd: repo,
      listTools: async () => [{ name: "list_projects" }],
      callTool: async (name, args) => {
        assert.equal(name, "list_projects");
        assert.deepEqual(args, { query: "Roadmap", limit: 10 });
        return {
          structuredContent: {
            projects: [{ name: "Roadmap", workspace: { name: "Acme" } }],
          },
        };
      },
    }),
  );

  assert.match(initOutput, /project: initialized/);
  assert.deepEqual(JSON.parse(await readFile(join(repo, ".linear-project"), "utf8")), {
    workspace: "Acme",
    project: "Roadmap",
  });
});

test("repo project default validates before project-scoped list commands", async () => {
  const repo = await mkdtemp(join(tmpdir(), "linear-axi-repo-"));
  await mkdir(join(repo, ".git"));
  await writeFile(join(repo, ".linear-project"), JSON.stringify({ project: "Linear AXI" }), "utf8");
  let issueListCalled = false;

  expectFailure(
    await cli(
      ["issues", "list"],
      runtime({
        cwd: repo,
        listTools: async () => [{ name: "list_projects" }, { name: "list_issues" }],
        callTool: async (name) => {
          if (name === "list_projects") return { structuredContent: { projects: [] } };
          issueListCalled = true;
          return { structuredContent: { issues: [] } };
        },
      }),
    ),
    2,
    /The saved default Linear project does not exist in the authenticated workspace: Linear AXI/,
  );

  assert.equal(issueListCalled, false);
});

test("repo project validation preserves configured slug for downstream commands", async () => {
  const repo = await mkdtemp(join(tmpdir(), "linear-axi-repo-"));
  await mkdir(join(repo, ".git"));
  await writeFile(
    join(repo, ".linear-project"),
    JSON.stringify({ project: "roadmap-slug" }),
    "utf8",
  );
  let seen;

  await ok(
    ["issues", "list"],
    runtime({
      cwd: repo,
      listTools: async () => [{ name: "list_projects" }, { name: "list_issues" }],
      callTool: async (name, args) => {
        if (name === "list_projects") {
          assert.deepEqual(args, { query: "roadmap-slug", limit: 10 });
          return { structuredContent: { projects: [{ slugId: "roadmap-slug", name: "Roadmap" }] } };
        }
        seen = { name, args };
        return { structuredContent: { issues: [] } };
      },
    }),
  );

  assert.deepEqual(seen, { name: "list_issues", args: { project: "roadmap-slug", limit: 50 } });
});

test("repo project validation accepts project uuids with get_project", async () => {
  const repo = await mkdtemp(join(tmpdir(), "linear-axi-repo-"));
  await mkdir(join(repo, ".git"));
  const projectId = "5bf051dd-8c53-4fd9-a606-58dbeae18ec4";
  await writeFile(
    join(repo, ".linear-project"),
    JSON.stringify({ workspace: "Acme", project: projectId }),
    "utf8",
  );
  let seen;

  await ok(
    ["issues", "list"],
    runtime({
      cwd: repo,
      listTools: async () => [
        { name: "get_project" },
        { name: "list_projects" },
        { name: "list_issues" },
      ],
      callTool: async (name, args) => {
        if (name === "get_project") {
          assert.deepEqual(args, { query: projectId });
          return {
            structuredContent: { id: projectId, name: "Roadmap", workspace: { name: "Acme" } },
          };
        }
        seen = { name, args };
        return { structuredContent: { issues: [] } };
      },
    }),
  );

  assert.deepEqual(seen, { name: "list_issues", args: { project: projectId, limit: 50 } });
});

test("repo project validation falls back to list_projects after get_project misses", async () => {
  const repo = await mkdtemp(join(tmpdir(), "linear-axi-repo-"));
  await mkdir(join(repo, ".git"));
  await writeFile(
    join(repo, ".linear-project"),
    JSON.stringify({ project: "roadmap-slug" }),
    "utf8",
  );
  const calls = [];

  await ok(
    ["issues", "list"],
    runtime({
      cwd: repo,
      listTools: async () => [
        { name: "get_project" },
        { name: "list_projects" },
        { name: "list_issues" },
      ],
      callTool: async (name, args) => {
        calls.push({ name, args });
        if (name === "get_project") return { structuredContent: {} };
        if (name === "list_projects") {
          return { structuredContent: { projects: [{ slugId: "roadmap-slug", name: "Roadmap" }] } };
        }
        return { structuredContent: { issues: [] } };
      },
    }),
  );

  assert.deepEqual(calls, [
    { name: "get_project", args: { query: "roadmap-slug" } },
    { name: "list_projects", args: { query: "roadmap-slug", limit: 10 } },
    { name: "list_issues", args: { project: "roadmap-slug", limit: 50 } },
  ]);
});

test("invalid repo project help quotes saved project tokens", async () => {
  const repo = await mkdtemp(join(tmpdir(), "linear-axi-repo-"));
  await mkdir(join(repo, ".git"));
  await writeFile(
    join(repo, ".linear-project"),
    JSON.stringify({ project: "$(touch /tmp/pwned)" }),
    "utf8",
  );

  const output = expectFailure(
    await cli(
      ["issues", "list"],
      runtime({
        cwd: repo,
        listTools: async () => [{ name: "list_projects" }],
        callTool: async () => ({ structuredContent: { projects: [] } }),
      }),
    ),
    2,
    /The saved default Linear project does not exist/,
  );
  assert.match(output, /--query '\$\(touch \/tmp\/pwned\)' --fields id,name,status/);
  assert.doesNotMatch(output, /--query \\?"\$\(touch/);
});

test("repo project default applies to issue creates but not updates", async () => {
  const repo = await mkdtemp(join(tmpdir(), "linear-axi-repo-"));
  await mkdir(join(repo, ".git"));
  await writeFile(
    join(repo, ".linear-project"),
    `${JSON.stringify({ project: "Roadmap" })}\n`,
    "utf8",
  );

  let seen;
  const createOutput = await ok(
    ["issues", "create", "--title", "Fix auth", "--team", "ENG"],
    runtime({
      cwd: repo,
      callTool: async (name, args) => {
        if (name === "list_issues") return { structuredContent: { issues: [] } };
        seen = { name, args };
        return { structuredContent: { identifier: "LIN-1", title: "Fix auth" } };
      },
    }),
  );

  assert.deepEqual(seen, {
    name: "save_issue",
    args: { title: "Fix auth", team: "ENG", project: "Roadmap" },
  });
  assert.doesNotMatch(createOutput, /help\[/);

  const updateOutput = await ok(
    ["issues", "update", "--id", "LIN-1", "--state", "Done"],
    runtime({
      cwd: repo,
      listTools: async () => [{ name: "get_issue" }],
      callTool: async (name, args) => {
        if (name === "get_issue")
          return { structuredContent: { identifier: "LIN-1", title: "Fix auth" } };
        seen = { name, args };
        return { structuredContent: { identifier: "LIN-1", title: "Fix auth" } };
      },
    }),
  );

  assert.deepEqual(seen, { name: "save_issue", args: { id: "LIN-1", state: "Done" } });
  assert.doesNotMatch(updateOutput, /help\[/);
});

test("issue create without explicit or initialized project omits project", async () => {
  const repo = await mkdtemp(join(tmpdir(), "linear-axi-repo-"));
  await mkdir(join(repo, ".git"));

  let seen;
  await ok(
    ["issues", "create", "--title", "Fix auth", "--team", "ENG"],
    runtime({
      cwd: repo,
      callTool: async (name, args) => {
        if (name === "list_issues") return { structuredContent: { issues: [] } };
        seen = { name, args };
        return { structuredContent: { identifier: "LIN-1", title: "Fix auth" } };
      },
    }),
  );

  assert.deepEqual(seen, { name: "save_issue", args: { title: "Fix auth", team: "ENG" } });
});

test("repo project default applies to document creates but not updates", async () => {
  const repo = await mkdtemp(join(tmpdir(), "linear-axi-repo-"));
  await mkdir(join(repo, ".git"));
  await writeFile(
    join(repo, ".linear-project"),
    `${JSON.stringify({ project: "Roadmap" })}\n`,
    "utf8",
  );

  let seen;
  await ok(
    ["documents", "create", "--title", "Spec", "--project", "Roadmap"],
    runtime({
      cwd: repo,
      listTools: async () => [{ name: "create_document" }, { name: "update_document" }],
      callTool: async (name, args) => {
        seen = { name, args };
        return { structuredContent: { id: "doc1", title: "Spec" } };
      },
    }),
  );

  assert.deepEqual(seen, { name: "create_document", args: { title: "Spec", project: "Roadmap" } });

  await ok(
    ["documents", "update", "--id", "doc1", "--title", "Updated"],
    runtime({
      cwd: repo,
      listTools: async () => [
        { name: "create_document" },
        { name: "update_document" },
        { name: "get_document" },
      ],
      callTool: async (name, args) => {
        if (name === "get_document") return { structuredContent: { id: "doc1", title: "Spec" } };
        seen = { name, args };
        return { structuredContent: { id: "doc1", title: "Updated" } };
      },
    }),
  );

  assert.deepEqual(seen, { name: "update_document", args: { id: "doc1", title: "Updated" } });
});

test("document create without another parent requires explicit or initialized project", async () => {
  const repo = await mkdtemp(join(tmpdir(), "linear-axi-repo-"));
  await mkdir(join(repo, ".git"));
  let called = false;

  expectFailure(
    await cli(
      ["documents", "create", "--title", "Spec"],
      runtime({
        cwd: repo,
        callTool: async () => {
          called = true;
          return {};
        },
      }),
    ),
    2,
    /No default Linear project is configured for this repository/,
  );

  assert.equal(called, false);
});

test("repo project default applies to milestone creates and updates use explicit projects", async () => {
  const repo = await mkdtemp(join(tmpdir(), "linear-axi-repo-"));
  await mkdir(join(repo, ".git"));
  await writeFile(
    join(repo, ".linear-project"),
    `${JSON.stringify({ project: "Roadmap" })}\n`,
    "utf8",
  );

  let seen;
  await ok(
    ["milestones", "create", "--name", "Beta"],
    runtime({
      cwd: repo,
      callTool: async (name, args) => {
        seen = { name, args };
        return { structuredContent: { id: "m1", name: "Beta" } };
      },
    }),
  );

  assert.deepEqual(seen, { name: "save_milestone", args: { name: "Beta", project: "Roadmap" } });

  await ok(
    ["milestones", "update", "--project", "Roadmap", "--id", "m1", "--targetDate", "2026-09-01"],
    runtime({
      cwd: repo,
      callTool: async (name, args) => {
        if (name === "get_milestone") return { structuredContent: { id: "m1", name: "Beta" } };
        seen = { name, args };
        return { structuredContent: { id: "m1", name: "Beta" } };
      },
    }),
  );

  assert.deepEqual(seen, {
    name: "save_milestone",
    args: { id: "m1", project: "Roadmap", targetDate: "2026-09-01" },
  });
});

test("milestone list and create require explicit or initialized project", async () => {
  const repo = await mkdtemp(join(tmpdir(), "linear-axi-repo-"));
  await mkdir(join(repo, ".git"));
  let called = false;

  expectFailure(
    await cli(
      ["milestones", "list"],
      runtime({
        cwd: repo,
        callTool: async () => {
          called = true;
          return {};
        },
      }),
    ),
    2,
    /No default Linear project is configured for this repository/,
  );

  expectFailure(
    await cli(
      ["milestones", "create", "--name", "Beta"],
      runtime({
        cwd: repo,
        callTool: async () => {
          called = true;
          return {};
        },
      }),
    ),
    2,
    /No default Linear project is configured for this repository/,
  );

  assert.equal(called, false);
});

test("repo project discovery walks up from a subdirectory and explicit project wins", async () => {
  const repo = await mkdtemp(join(tmpdir(), "linear-axi-repo-"));
  const child = join(repo, "packages", "app");
  await mkdir(join(repo, ".git"));
  await mkdir(child, { recursive: true });
  await writeFile(
    join(repo, ".linear-project"),
    `${JSON.stringify({ project: "Roadmap" })}\n`,
    "utf8",
  );

  let seen;
  await ok(
    ["issues", "list", "--project", "Other"],
    runtime({
      cwd: child,
      callTool: async (name, args) => {
        seen = { name, args };
        return { structuredContent: { issues: [] } };
      },
    }),
  );

  assert.deepEqual(seen, { name: "list_issues", args: { project: "Other", limit: 50 } });
});

test("init requires a Git repository before writing .linear-project", async (t) => {
  const dir = await makeNoGitTempDir();
  if (!dir) {
    t.skip("no writable temp parent without a .git ancestor");
    return;
  }

  expectFailure(
    await cli(["init", "--project", "Roadmap"], runtime({ cwd: dir })),
    2,
    /current directory is not inside a Git repository/,
  );
});

test("init is idempotent and protects existing project values", async () => {
  const repo = await mkdtemp(join(tmpdir(), "linear-axi-repo-"));
  await mkdir(join(repo, ".git"));
  await writeFile(
    join(repo, ".linear-project"),
    `${JSON.stringify({ project: "Roadmap" })}\n`,
    "utf8",
  );

  const same = await ok(["init", "--project", "Roadmap"], runtime({ cwd: repo }));
  assert.match(same, /project: already initialized/);
  assert.doesNotMatch(same, /help\[/);

  expectFailure(
    await cli(["init", "--project", "Other"], runtime({ cwd: repo })),
    2,
    /\.linear-project already exists/,
  );

  const replaced = await ok(["init", "--project", "Other", "--force"], runtime({ cwd: repo }));
  assert.match(replaced, /project: initialized/);
  assert.doesNotMatch(replaced, /help\[/);
  assert.deepEqual(JSON.parse(await readFile(join(repo, ".linear-project"), "utf8")), {
    project: "Other",
  });
});

test("comments create uses comment-oriented flags", async () => {
  let seen;
  const output = await ok(
    ["comments", "create", "--issue", "LIN-1", "--body", "Ready"],
    runtime({
      listTools: async () => [{ name: "get_issue" }],
      callTool: async (name, args) => {
        if (name === "get_issue")
          return { structuredContent: { identifier: "LIN-1", title: "Task" } };
        seen = { name, args };
        return { structuredContent: { id: "c1", body: "Ready" } };
      },
    }),
  );

  assert.deepEqual(seen, { name: "save_comment", args: { issueId: "LIN-1", body: "Ready" } });
  assert.match(output, /comment:/);
  assert.match(output, /id: c1/);
  assert.doesNotMatch(output, /help\[/);
  assert.doesNotMatch(output, /linear-axi comments list/);
});

test("comments create returns compact preview output", async () => {
  const output = await ok(
    ["comments", "create", "--issue", "LIN-1", "--body", "Ready"],
    runtime({
      listTools: async () => [{ name: "get_issue" }],
      callTool: async (name) => {
        if (name === "get_issue")
          return { structuredContent: { identifier: "LIN-1", title: "Task" } };
        return {
          structuredContent: {
            id: "c1",
            body: "a".repeat(121),
            author: { name: "Morris" },
            createdAt: "2026-07-04T12:00:00Z",
            metadata: "hidden",
          },
        };
      },
    }),
  );

  assert.match(output, /comment:/);
  assert.match(output, /id: c1/);
  assert.match(output, /author: Morris/);
  assert.match(output, /created: "2026-07-04T12:00:00Z"/);
  assert.match(output, /\.\.\. \(truncated, 121 chars total\)/);
  assert.doesNotMatch(output, /metadata/);
  assert.match(
    output,
    /help\[1\]: Run `linear-axi comments list --issue LIN-1 --full` to show complete comment bodies/,
  );
  assert.doesNotMatch(output, /Run `linear-axi comments list --issue LIN-1` to verify comments/);
});

test("comments create treats text-only mutation responses as errors", async () => {
  expectFailure(
    await cli(
      ["comments", "create", "--issue", "LIN-1", "--body", "Ready"],
      runtime({
        listTools: async () => [{ name: "get_issue" }],
        callTool: async (name) => {
          if (name === "get_issue")
            return { structuredContent: { identifier: "LIN-1", title: "Task" } };
          return { structuredContent: { text: "Issue not found" } };
        },
      }),
    ),
    1,
    /Issue not found/,
  );
});

test("comments list accepts bare full flag", async () => {
  let seen;
  const output = await ok(
    ["comments", "list", "--issue", "LIN-1", "--full"],
    runtime({
      callTool: async (name, args) => {
        seen = { name, args };
        return { structuredContent: { comments: [{ id: "c1", body: "Ready", extra: "kept" }] } };
      },
    }),
  );

  assert.deepEqual(seen, { name: "list_comments", args: { issueId: "LIN-1", limit: 50 } });
  assert.match(output, /comments\[1\]\{id,body,extra\}:/);
  assert.match(output, /c1,Ready,kept/);
});

test("comments list emits pagination hints", async () => {
  let seen;
  const output = await ok(
    ["comments", "list", "--issue", "LIN-1", "--orderBy", "createdAt", "--limit", "10", "--full"],
    runtime({
      callTool: async (name, args) => {
        seen = { name, args };
        return {
          structuredContent: {
            comments: [{ id: "c1", body: "Ready" }],
            pageInfo: { hasNextPage: true, endCursor: "next-comments" },
          },
        };
      },
    }),
  );

  assert.deepEqual(seen, {
    name: "list_comments",
    args: { issueId: "LIN-1", limit: 10, orderBy: "createdAt" },
  });
  assert.match(output, /count: 1 returned \(more available\)/);
  assert.match(output, /cursor: next-comments/);
  assert.match(output, /comments\[1\]\{id,body\}:/);
  assert.match(
    output,
    /Run `linear-axi comments list --issue LIN-1 --limit 10 --orderBy createdAt --full --cursor next-comments` to continue/,
  );
});

test("comments list pagination hints preserve false full flag", async () => {
  const output = await ok(
    ["comments", "list", "--issue", "LIN-1", "--limit", "10", "--full=false"],
    runtime({
      callTool: async () => ({
        structuredContent: {
          comments: [{ id: "c1", body: "Ready" }],
          pageInfo: { hasNextPage: true, endCursor: "next-comments" },
        },
      }),
    }),
  );

  assert.match(
    output,
    /Run `linear-axi comments list --issue LIN-1 --limit 10 --full=false --cursor next-comments` to continue/,
  );
  assert.doesNotMatch(output, /--full false/);
});

test("comments list keeps bodies up to 1000 chars and truncates longer ones", async () => {
  const output = await ok(
    ["comments", "list", "--issue", "LIN-1"],
    runtime({
      callTool: async () => ({
        structuredContent: {
          comments: [
            { id: "c1", body: "b".repeat(1000), author: { name: "Morris" } },
            { id: "c2", body: "a".repeat(1001), author: { name: "Morris" } },
          ],
        },
      }),
    }),
  );

  assert.match(output, /count: 2 returned/);
  assert.match(output, new RegExp(`c1,Morris,"",${"b".repeat(1000)}\\n`));
  assert.match(output, /\.\.\. \(truncated, 1001 chars total\)/);
  assert.match(
    output,
    /Run `linear-axi comments list --issue LIN-1 --full` to show complete comment bodies/,
  );
});

test("comments reject unsupported parent flags before MCP calls", async () => {
  let called = false;
  const client = runtime({
    callTool: async () => {
      called = true;
      return {};
    },
  });

  expectFailure(
    await cli(["comments", "list", "--project", "Roadmap"], client),
    2,
    /unknown flag --project/,
  );
  expectFailure(
    await cli(["comments", "create", "--parentId", "comment-id", "--body", "Reply"], client),
    2,
    /unknown flag --parentId/,
  );

  assert.equal(called, false);
});

test("comments create requires an issue", async () => {
  let called = false;

  expectFailure(
    await cli(
      ["comments", "create", "--body", "Ready"],
      runtime({
        callTool: async () => {
          called = true;
          return {};
        },
      }),
    ),
    2,
    /comments create requires --issue/,
  );

  assert.equal(called, false);
});

test("comments create requires a body before checking the issue", async () => {
  let called = false;

  expectFailure(
    await cli(
      ["comments", "create", "--issue", "LIN-1"],
      runtime({
        callTool: async () => {
          called = true;
          return {};
        },
      }),
    ),
    2,
    /--body or --body-file is required/,
  );

  assert.equal(called, false);
});

test("numeric flags reject invalid finite numbers before MCP calls", async () => {
  let called = false;

  const client = runtime({
    callTool: async () => {
      called = true;
      return {};
    },
  });

  expectFailure(await cli(["issues", "list", "--limit", "abc"], client), 2, /--limit/);
  expectFailure(await cli(["issues", "list", "--limit", "0"], client), 2, /--limit/);
  expectFailure(
    await cli(
      ["issues", "create", "--title", "Task", "--team", "ENG", "--priority", "Infinity"],
      client,
    ),
    2,
    /--priority/,
  );

  assert.equal(called, false);
});

test("auth login manual prints authorization url without finishing", async () => {
  let finished = false;
  const output = await ok(
    ["auth", "login", "--manual"],
    runtime({
      listTools: async () => {
        const error = new Error("auth required");
        error.authorizationUrl =
          "https://linear.example/authorize?code_challenge=test&state=expected-state";
        throw error;
      },
      finishAuth: async () => {
        finished = true;
      },
    }),
  );

  assert.match(output, /auth: Linear MCP OAuth authorization required/);
  assert.match(
    output,
    /url: "https:\/\/linear.example\/authorize\?code_challenge=test&state=expected-state"/,
  );
  assert.equal(finished, false);
});

test("auth login callback flow keeps progress on stderr and only the result on stdout", async () => {
  const progress = [];
  const finishedCodes = [];
  const login = cli(["auth", "login", "--timeout", "5000"], {
    ...runtime({
      listTools: async () => {
        const error = new Error("auth required");
        error.authorizationUrl =
          "https://linear.example/authorize?code_challenge=test&state=expected-state";
        throw error;
      },
      finishAuth: async (code) => {
        finishedCodes.push(code);
      },
    }),
    stderr: { write: (text) => progress.push(text) },
  });

  await waitFor(() => progress.join("").includes("http://127.0.0.1:14566/oauth/callback"));
  assert.match(
    progress.join(""),
    /https:\/\/linear\.example\/authorize\?code_challenge=test&state=expected-state/,
  );
  const rejected = await fetch(
    "http://127.0.0.1:14566/oauth/callback?code=wrong-code&state=wrong-state",
  );
  assert.equal(rejected.status, 400);
  assert.deepEqual(finishedCodes, []);

  const response = await fetch(
    "http://127.0.0.1:14566/oauth/callback?code=test-code&state=expected-state",
  );
  assert.equal(response.status, 200);

  const { output, exitCode } = await login;
  assert.equal(exitCode, 0);
  assert.deepEqual(finishedCodes, ["test-code"]);
  assert.equal(output, "auth: Linear MCP OAuth authorized\n");
});

test("auth logout clears local OAuth credentials", async () => {
  let called = false;
  const output = await ok(
    ["auth", "logout"],
    runtime({
      logoutAuth: async () => {
        called = true;
        return { removed: true, tokenConfigured: false };
      },
    }),
  );

  assert.equal(called, true);
  assert.match(output, /auth: Linear MCP OAuth credentials cleared/);
});

test("auth logout is an idempotent no-op when credentials are absent", async () => {
  const output = await ok(
    ["auth", "logout"],
    runtime({
      logoutAuth: async () => ({ removed: false, tokenConfigured: true }),
    }),
  );

  assert.match(output, /auth: Linear MCP OAuth credentials already absent/);
  assert.match(output, /note: LINEAR_AXI_MCP_TOKEN or LINEAR_MCP_TOKEN remains configured/);
});

test("issues view full returns only matching issue detail", async () => {
  const calls = [];
  const output = await ok(
    ["issues", "view", "LIN-1", "--full"],
    runtime({
      listTools: async () => [{ name: "get_issue" }],
      callTool: async (name, args) => {
        calls.push({ name, args });
        return {
          structuredContent: {
            id: "issue-id",
            identifier: "LIN-1",
            title: "Right",
            description: "Full body",
          },
        };
      },
    }),
  );

  assert.deepEqual(calls, [{ name: "get_issue", args: { id: "LIN-1" } }]);
  assert.match(output, /title: Right/);
  assert.match(output, /description: Full body/);
  assert.doesNotMatch(output, /Wrong/);
});

test("issues view compact output previews long descriptions", async () => {
  const description = `${"a".repeat(4001)} tail`;
  const output = await ok(
    ["issues", "view", "LIN-1"],
    runtime({
      listTools: async () => [{ name: "get_issue" }],
      callTool: async () => ({
        structuredContent: {
          identifier: "LIN-1",
          title: "Right",
          description,
          assignee: { name: "Morris" },
          state: { name: "Todo" },
        },
      }),
    }),
  );

  assert.match(output, /issue:/);
  assert.match(output, /description: ".+\.\.\. \(truncated, 4006 chars total\)"/);
  assert.match(
    output,
    /help\[1\]: Run `linear-axi issues view LIN-1 --full` to show the complete issue/,
  );
});

test("issues view compact output includes short descriptions without noisy help", async () => {
  const output = await ok(
    ["issues", "view", "LIN-1"],
    runtime({
      listTools: async () => [{ name: "get_issue" }],
      callTool: async () => ({
        structuredContent: {
          identifier: "LIN-1",
          title: "Right",
          description: "Short body",
        },
      }),
    }),
  );

  assert.match(output, /description: Short body/);
  assert.doesNotMatch(output, /--full/);
});

test("issues view missing issue returns not found", async () => {
  const output = expectFailure(
    await cli(
      ["issues", "view", "LIN-404"],
      runtime({
        listTools: async () => [{ name: "get_issue" }],
        callTool: async () => ({ structuredContent: {} }),
      }),
    ),
    1,
    /issue not found: LIN-404/,
  );
  assert.match(output, /code: NOT_FOUND/);
});

test("issues view all is rejected instead of returning an empty detail", async () => {
  let called = false;
  expectFailure(
    await cli(
      ["issues", "view", "all"],
      runtime({
        callTool: async () => {
          called = true;
          return {};
        },
      }),
    ),
    2,
    /issues view expects one issue id/,
  );
  assert.equal(called, false);
});

test("issues view treats blank issue-shaped responses as not found", async () => {
  const output = expectFailure(
    await cli(
      ["issues", "view", "LIN-404"],
      runtime({
        listTools: async () => [{ name: "get_issue" }],
        callTool: async () => ({
          structuredContent: { identifier: "", title: "", state: "", assignee: "" },
        }),
      }),
    ),
    1,
    /issue not found: LIN-404/,
  );
  assert.match(output, /code: NOT_FOUND/);
});

test("issues view falls back to exact list match when get_issue is unavailable", async () => {
  const calls = [];
  const output = await ok(
    ["issues", "view", "LIN-1", "--full"],
    runtime({
      listTools: async () => [{ name: "list_issues" }],
      callTool: async (name, args) => {
        calls.push({ name, args });
        return {
          structuredContent: {
            issues: [
              { id: "other", identifier: "LIN-10", title: "Wrong" },
              { id: "issue-id", identifier: "LIN-1", title: "Right" },
            ],
          },
        };
      },
    }),
  );

  assert.deepEqual(calls, [{ name: "list_issues", args: { query: "LIN-1", limit: 10 } }]);
  assert.match(output, /title: Right/);
  assert.doesNotMatch(output, /Wrong/);
});

test("documents create and update use create or update document tools", async () => {
  let seen;
  await ok(
    ["documents", "create", "--title", "Spec", "--project", "Roadmap"],
    runtime({
      listTools: async () => [{ name: "create_document" }, { name: "update_document" }],
      callTool: async (name, args) => {
        seen = { name, args };
        return { structuredContent: { id: "doc1", title: "Spec" } };
      },
    }),
  );

  assert.deepEqual(seen, { name: "create_document", args: { title: "Spec", project: "Roadmap" } });

  const updateOutput = await ok(
    ["documents", "update", "--id", "doc1", "--content", "Updated"],
    runtime({
      listTools: async () => [
        { name: "get_document" },
        { name: "create_document" },
        { name: "update_document" },
      ],
      callTool: async (name, args) => {
        if (name === "get_document") return { structuredContent: { id: "doc1", title: "Spec" } };
        seen = { name, args };
        return { structuredContent: { id: "doc1", title: "Spec" } };
      },
    }),
  );

  assert.deepEqual(seen, { name: "update_document", args: { id: "doc1", content: "Updated" } });
  assert.doesNotMatch(updateOutput, /help\[/);
});

test("explicit create commands reject id before MCP calls", async () => {
  for (const args of [
    ["issues", "create", "--id", "LIN-1", "--title", "Task", "--team", "ENG"],
    ["projects", "create", "--id", "p1", "--name", "Roadmap", "--team", "ENG"],
    ["documents", "create", "--id", "doc1", "--title", "Spec"],
    ["milestones", "create", "--project", "Roadmap", "--id", "m1", "--name", "Beta"],
  ]) {
    let called = false;

    expectFailure(
      await cli(
        args,
        runtime({
          callTool: async () => {
            called = true;
            return {};
          },
        }),
      ),
      2,
      /--id/,
    );

    assert.equal(called, false);
  }
});

test("documents view uses get_document and rewrites MCP-native truncation hints", async () => {
  const output = await ok(
    ["documents", "view", "doc1"],
    runtime({
      listTools: async () => [{ name: "get_document" }],
      callTool: async (name, args) => {
        assert.equal(name, "get_document");
        assert.deepEqual(args, { id: "doc1" });
        return {
          structuredContent: {
            id: "doc1",
            title: "Spec",
            content: "short preview (truncated, use `get_document` for full description)",
          },
        };
      },
    }),
  );

  assert.match(output, /document:/);
  assert.match(output, /title: Spec/);
  assert.match(output, /linear-axi documents view doc1 --full/);
  assert.doesNotMatch(output, /get_document/);
});

test("documents create returns compact mutation output", async () => {
  const output = await ok(
    ["documents", "create", "--title", "Spec", "--team", "ENG", "--content", "Body"],
    runtime({
      listTools: async () => [{ name: "create_document" }],
      callTool: async () => ({
        structuredContent: {
          id: "doc1",
          title: "Spec",
          content: "Body",
          url: "https://linear/doc1",
          extra: "hidden",
        },
      }),
    }),
  );

  assert.match(output, /document:/);
  assert.match(output, /id: doc1/);
  assert.match(output, /title: Spec/);
  assert.doesNotMatch(output, /extra/);
  assert.doesNotMatch(output, /help\[/);
  assert.doesNotMatch(output, /linear-axi documents view doc1/);
});

test("projects create wraps create_project and returns compact output", async () => {
  let seen;
  const output = await ok(
    ["projects", "create", "--name", "Roadmap", "--team", "ENG", "--summary", "Plan"],
    runtime({
      listTools: async () => [{ name: "create_project" }],
      callTool: async (name, args) => {
        if (name === "list_projects") return { structuredContent: { projects: [] } };
        seen = { name, args };
        return {
          structuredContent: {
            id: "p1",
            name: "Roadmap",
            status: { name: "Planned" },
            team: { name: "ENG" },
            extra: "hidden",
          },
        };
      },
    }),
  );

  assert.deepEqual(seen, {
    name: "create_project",
    args: { name: "Roadmap", team: "ENG", summary: "Plan" },
  });
  assert.match(output, /project:/);
  assert.match(output, /id: p1/);
  assert.doesNotMatch(output, /extra/);
  assert.doesNotMatch(output, /help\[/);
});

test("projects create maps team when falling back to save_project create shape", async () => {
  let seen;
  const output = await ok(
    ["projects", "create", "--name", "Roadmap", "--team", "ENG", "--summary", "Plan"],
    runtime({
      listTools: async () => [{ name: "save_project" }],
      callTool: async (name, args) => {
        if (name === "list_projects") return { structuredContent: { projects: [] } };
        seen = { name, args };
        return {
          structuredContent: {
            id: "p1",
            name: "Roadmap",
            status: { name: "Planned" },
            teams: [{ name: "ENG" }],
          },
        };
      },
    }),
  );

  assert.deepEqual(seen, {
    name: "save_project",
    args: { name: "Roadmap", summary: "Plan", setTeams: ["ENG"] },
  });
  assert.match(output, /project:/);
  assert.match(output, /team: ENG/);
  assert.doesNotMatch(output, /help\[/);
});

test("projects create maps team when retrying unknown create_project with save_project", async () => {
  const seen = [];
  await ok(
    ["projects", "create", "--name", "Roadmap", "--teamId", "team-1", "--summary", "Plan"],
    runtime({
      callTool: async (name, args) => {
        if (name === "list_projects") return { structuredContent: { projects: [] } };
        seen.push({ name, args });
        if (name === "create_project") throw new Error("unknown tool: create_project");
        return { structuredContent: { id: "p1", name: "Roadmap" } };
      },
    }),
  );

  assert.deepEqual(seen, [
    { name: "create_project", args: { name: "Roadmap", teamId: "team-1", summary: "Plan" } },
    { name: "save_project", args: { name: "Roadmap", summary: "Plan", setTeams: ["team-1"] } },
  ]);
});

test("projects update maps team when update falls back to save_project", async () => {
  let seen;
  const updateOutput = await ok(
    ["projects", "update", "--id", "p1", "--team", "ENG", "--summary", "Plan"],
    runtime({
      listTools: async () => [{ name: "save_project" }],
      callTool: async (name, args) => {
        if (name === "list_projects")
          return { structuredContent: { projects: [{ id: "p1", name: "Roadmap" }] } };
        seen = { name, args };
        return { structuredContent: { id: "p1", name: "Roadmap" } };
      },
    }),
  );

  assert.deepEqual(seen, {
    name: "save_project",
    args: { id: "p1", summary: "Plan", addTeams: ["ENG"] },
  });
  assert.doesNotMatch(updateOutput, /help\[/);
});

test("projects update validates with get_project before mutation", async () => {
  const calls = [];

  await ok(
    ["projects", "update", "--id", "5bf051dd-8c53-4fd9-a606-58dbeae18ec4", "--summary", "Plan"],
    runtime({
      listTools: async () => [{ name: "get_project" }, { name: "save_project" }],
      callTool: async (name, args) => {
        calls.push({ name, args });
        if (name === "get_project") {
          return {
            structuredContent: { id: "5bf051dd-8c53-4fd9-a606-58dbeae18ec4", name: "Roadmap" },
          };
        }
        return {
          structuredContent: { id: "5bf051dd-8c53-4fd9-a606-58dbeae18ec4", name: "Roadmap" },
        };
      },
    }),
  );

  assert.deepEqual(calls, [
    { name: "get_project", args: { query: "5bf051dd-8c53-4fd9-a606-58dbeae18ec4" } },
    { name: "save_project", args: { id: "5bf051dd-8c53-4fd9-a606-58dbeae18ec4", summary: "Plan" } },
  ]);
});

test("projects update falls back to list_projects after get_project mismatch", async () => {
  const calls = [];

  await ok(
    ["projects", "update", "--id", "roadmap-slug", "--summary", "Plan"],
    runtime({
      listTools: async () => [
        { name: "get_project" },
        { name: "list_projects" },
        { name: "save_project" },
      ],
      callTool: async (name, args) => {
        calls.push({ name, args });
        if (name === "get_project") return { structuredContent: { id: "other", name: "Other" } };
        if (name === "list_projects") {
          return { structuredContent: { projects: [{ slugId: "roadmap-slug", name: "Roadmap" }] } };
        }
        return { structuredContent: { slugId: "roadmap-slug", name: "Roadmap" } };
      },
    }),
  );

  assert.deepEqual(calls, [
    { name: "get_project", args: { query: "roadmap-slug" } },
    { name: "list_projects", args: { query: "roadmap-slug", limit: 10 } },
    { name: "save_project", args: { id: "roadmap-slug", summary: "Plan" } },
  ]);
});

test("projects update falls back to list_projects after blank project detail", async () => {
  const calls = [];
  let toolDiscoveryCalls = 0;

  await ok(
    ["projects", "update", "--id", "roadmap-slug", "--summary", "Plan"],
    runtime({
      listTools: async () => {
        toolDiscoveryCalls += 1;
        return [{ name: "get_project" }, { name: "list_projects" }, { name: "save_project" }];
      },
      callTool: async (name, args) => {
        calls.push({ name, args });
        if (name === "get_project") return { structuredContent: {} };
        if (name === "list_projects") {
          return { structuredContent: { projects: [{ slugId: "roadmap-slug", name: "Roadmap" }] } };
        }
        return { structuredContent: { slugId: "roadmap-slug", name: "Roadmap" } };
      },
    }),
  );

  assert.deepEqual(calls, [
    { name: "get_project", args: { query: "roadmap-slug" } },
    { name: "list_projects", args: { query: "roadmap-slug", limit: 10 } },
    { name: "save_project", args: { id: "roadmap-slug", summary: "Plan" } },
  ]);
  assert.equal(toolDiscoveryCalls, 2);
});

test("milestones create treats text-only mutation responses as errors", async () => {
  expectFailure(
    await cli(
      ["milestones", "create", "--project", "Roadmap", "--name", "Beta"],
      runtime({
        callTool: async () => ({ structuredContent: { text: "Milestone name is required" } }),
      }),
    ),
    1,
    /Milestone name is required/,
  );
});

test("milestones update rejects an empty milestone array before mutation", async () => {
  const calls = [];

  const output = expectFailure(
    await cli(
      ["milestones", "update", "--project", "Roadmap", "--id", "m1", "--targetDate", "2026-09-01"],
      runtime({
        callTool: async (name, args) => {
          calls.push({ name, args });
          if (name === "get_milestone") return { structuredContent: [] };
          return { structuredContent: { id: "m1" } };
        },
      }),
    ),
    1,
    /milestone not found: m1/,
  );
  assert.match(output, /code: NOT_FOUND/);

  assert.deepEqual(calls, [{ name: "get_milestone", args: { project: "Roadmap", query: "m1" } }]);
});

test("mutation text responses become structured errors", async () => {
  expectFailure(
    await cli(
      ["issues", "create", "--title", "Task", "--team", "ENG", "--project", "Wrong"],
      runtime({
        callTool: async (name) => {
          if (name === "list_issues") return { structuredContent: { issues: [] } };
          return { structuredContent: { text: "Project not in same team as issue" } };
        },
      }),
    ),
    1,
    /Project not in same team as issue/,
  );
});

test("issues create returns an existing same-title issue instead of creating a duplicate", async () => {
  const calls = [];
  const client = runtime({
    callTool: async (name, args) => {
      calls.push({ name, args });
      if (name === "list_issues") {
        return {
          structuredContent: {
            issues: [{ identifier: "LIN-1", title: "Task", team: { key: "ENG" } }],
          },
        };
      }
      return { structuredContent: { identifier: "LIN-2", title: "Task" } };
    },
  });

  const output = await ok(
    ["issues", "create", "--title", "Task", "--team", "ENG", "--project", "Roadmap"],
    client,
  );
  assert.match(output, /existing: true/);
  assert.match(output, /LIN-1/);
  assert.ok(!calls.some((call) => call.name === "save_issue"));

  calls.length = 0;
  const duplicate = await ok(
    ["issues", "create", "--title", "Task", "--team", "ENG", "--allow-duplicate"],
    client,
  );
  assert.doesNotMatch(duplicate, /existing: true/);
  assert.deepEqual(
    calls.map((call) => call.name),
    ["save_issue"],
  );
});

test("issues create ignores same-title issues from other teams", async () => {
  const calls = [];
  await ok(
    ["issues", "create", "--title", "Task", "--team", "ENG"],
    runtime({
      callTool: async (name, args) => {
        calls.push(name);
        if (name === "list_issues") {
          return {
            structuredContent: {
              issues: [{ identifier: "OPS-1", title: "Task", team: { key: "OPS" } }],
            },
          };
        }
        return { structuredContent: { identifier: "ENG-2", title: "Task" } };
      },
    }),
  );
  assert.ok(calls.includes("save_issue"));
});

test("issues update rejects a missing issue before mutation", async () => {
  const calls = [];

  const output = expectFailure(
    await cli(
      ["issues", "update", "--id", "LIN-404", "--state", "Done"],
      runtime({
        listTools: async () => [{ name: "get_issue" }],
        callTool: async (name, args) => {
          calls.push({ name, args });
          return { structuredContent: {} };
        },
      }),
    ),
    1,
    /issue not found: LIN-404/,
  );
  assert.match(output, /code: NOT_FOUND/);

  assert.deepEqual(calls, [{ name: "get_issue", args: { id: "LIN-404" } }]);
});

test("projects create returns an existing same-name project instead of creating a duplicate", async () => {
  let mutated = false;

  const output = await ok(
    ["projects", "create", "--name", "Roadmap", "--team", "ENG"],
    runtime({
      callTool: async (name) => {
        if (name === "list_projects") {
          return {
            structuredContent: {
              projects: [{ id: "p1", name: "Roadmap", team: { key: "ENG" } }],
            },
          };
        }
        mutated = true;
        return {};
      },
    }),
  );

  assert.match(output, /existing: true/);
  assert.match(output, /p1/);
  assert.equal(mutated, false);
});

test("projects update rejects a missing project before mutation", async () => {
  const calls = [];

  const output = expectFailure(
    await cli(
      ["projects", "update", "--id", "missing", "--summary", "Plan"],
      runtime({
        callTool: async (name, args) => {
          calls.push({ name, args });
          return { structuredContent: { projects: [] } };
        },
      }),
    ),
    1,
    /project not found: missing/,
  );
  assert.match(output, /code: NOT_FOUND/);

  assert.deepEqual(calls, [{ name: "list_projects", args: { query: "missing", limit: 10 } }]);
});

test("projects update rejects a missing project from get_project before mutation", async () => {
  const calls = [];

  const output = expectFailure(
    await cli(
      ["projects", "update", "--id", "missing", "--summary", "Plan"],
      runtime({
        listTools: async () => [{ name: "get_project" }, { name: "save_project" }],
        callTool: async (name, args) => {
          calls.push({ name, args });
          return { content: [{ type: "text", text: "Error: Project not found" }], isError: true };
        },
      }),
    ),
    1,
    /project not found: missing/,
  );
  assert.match(output, /code: NOT_FOUND/);

  assert.deepEqual(calls, [{ name: "get_project", args: { query: "missing" } }]);
});

test("resource group help is available before choosing a subcommand", async () => {
  const output = await ok(["projects", "--help"], runtime({}));

  assert.match(output, /usage: linear-axi projects <subcommand> \[flags\]/);
  assert.match(output, /subcommands\[3\]:\n  list, create, update/);
  assert.match(
    output,
    /flags\{list\}:\n  --query <text>, --team <team>, --state <state>, --limit <n> \(default 50\), --fields <a,b,c>, --full/,
  );
  assert.match(
    output,
    /flags\{create\}:\n  --name <text> \(required\), --team <team> or --teamId <id> \(required\)/,
  );
  assert.match(output, /flags\{update\}:\n  --id <id> \(required\)/);
});

test("issue group help summarizes list view create and update flags", async () => {
  const output = await ok(["issues", "--help"], runtime({}));

  assert.match(output, /flags\{list\}:/);
  assert.match(output, /--assignee <user>.*--fields <a,b,c>.*--full/);
  assert.match(output, /flags\{view\}:\n  --full \(show complete description without truncation\)/);
  assert.match(
    output,
    /flags\{create\}:\n  --title <text> \(required\), --team <team> \(required\)/,
  );
  assert.match(output, /flags\{update\}:\n  --id <id> \(required\)/);
});

test("statuses list uses issue status tool", async () => {
  let seen;
  await ok(
    ["statuses", "list", "--team", "ENG", "--full"],
    runtime({
      listTools: async () => [{ name: "list_issue_statuses" }],
      callTool: async (name, args) => {
        seen = { name, args };
        return { structuredContent: { statuses: [{ id: "s1", name: "Done" }] } };
      },
    }),
  );

  assert.deepEqual(seen, { name: "list_issue_statuses", args: { team: "ENG" } });
});

test("statuses list compacts status arrays from envelope", async () => {
  const output = await ok(
    ["statuses", "list", "--team", "ENG"],
    runtime({
      listTools: async () => [{ name: "list_issue_statuses" }],
      callTool: async () => ({
        structuredContent: { statuses: [{ id: "s1", name: "Done", type: "completed" }] },
      }),
    }),
  );

  assert.match(output, /statuses\[1\]\{id,name,type\}:/);
  assert.match(output, /s1,Done,completed/);
});

test("list tool errors exit 1 with the cleaned message instead of rendering rows", async () => {
  const output = expectFailure(
    await cli(
      ["comments", "list", "--issue", "LIN-404"],
      runtime({
        callTool: async () => ({
          isError: true,
          content: [
            {
              type: "text",
              text: 'Error: Could not find issue "LIN-404" for issueId. Pass the identifier as a JSON string.',
            },
          ],
        }),
      }),
    ),
    1,
    /^error: "?Could not find issue \\"LIN-404\\""?$/m,
  );

  assert.match(output, /code: NOT_FOUND/);
  assert.doesNotMatch(output, /Error:/);
  assert.doesNotMatch(output, /JSON/);
  assert.doesNotMatch(output, /comments(\[|:)/);
  assert.doesNotMatch(output, /count:/);
});

test("mutation tool errors with JSON bodies exit 1 without leaking request ids", async () => {
  const output = expectFailure(
    await cli(
      ["issues", "update", "--id", "LIN-7", "--title", "Renamed"],
      runtime({
        callTool: async (name) => {
          if (name === "get_issue") {
            return {
              structuredContent: { identifier: "LIN-7", title: "Old", team: { key: "ENG" } },
            };
          }
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: "InvalidInput",
                  message: "Argument Validation Error",
                  status: 400,
                  requestId: "req-8f2c",
                }),
              },
            ],
          };
        },
      }),
    ),
    1,
    /Argument Validation Error \(HTTP 400\)/,
  );

  assert.match(output, /code: OPERATION_ERROR/);
  assert.doesNotMatch(output, /req-8f2c|requestId/);
});

test("unknown and misspelled flags exit 2 before any Linear call", async () => {
  const calls = [];
  const client = runtime({
    listTools: async () => {
      calls.push("listTools");
      return [];
    },
    callTool: async (name) => {
      calls.push(name);
      return { structuredContent: {} };
    },
  });

  let output = expectFailure(
    await cli(["issues", "list", "--all-projects", "--asignee", "me"], client),
    2,
    /unknown flag --asignee/,
  );
  assert.match(output, /code: VALIDATION_ERROR/);

  output = expectFailure(
    await cli(["issues", "update", "--id", "LIN-1", "--stat", "Done"], client),
    2,
    /unknown flag --stat/,
  );
  assert.match(output, /code: VALIDATION_ERROR/);
  assert.deepEqual(calls, []);
});

test("issues update validates field values and requires a change before saving", async () => {
  const calls = [];
  const client = runtime({
    callTool: async (name) => {
      calls.push(name);
      return { structuredContent: { identifier: "LIN-1", title: "Task" } };
    },
  });

  for (const [args, pattern] of [
    [["--priority", "9"], /--priority/],
    [["--priority", "1.5"], /--priority/],
    [["--dueDate", "not-a-date"], /--dueDate/],
    [["--estimate", "lots"], /--estimate/],
    [[], /at least one field/],
  ]) {
    expectFailure(await cli(["issues", "update", "--id", "LIN-1", ...args], client), 2, pattern);
  }

  assert.ok(!calls.includes("save_issue"), calls.join(","));
});

test("issues update adds and removes labels without replacing the label set", async () => {
  let saved;
  await ok(
    ["issues", "update", "--id", "LIN-1", "--label", "Bug", "--remove-label", "Triage"],
    runtime({
      callTool: async (name, args) => {
        if (name === "save_issue") saved = args;
        return { structuredContent: { identifier: "LIN-1", title: "Task" } };
      },
    }),
  );

  assert.deepEqual(saved, { id: "LIN-1", addLabels: ["Bug"], removeLabels: ["Triage"] });
});

test("failed state updates point at the statuses lookup for the issue's team", async () => {
  const output = expectFailure(
    await cli(
      ["issues", "update", "--id", "LIN-7", "--state", "Nope"],
      runtime({
        callTool: async (name) => {
          if (name === "get_issue") {
            return {
              structuredContent: { identifier: "LIN-7", title: "Task", team: { key: "ENG" } },
            };
          }
          return {
            isError: true,
            content: [{ type: "text", text: 'Error: Could not find state "Nope"' }],
          };
        },
      }),
    ),
    1,
    /Could not find state/,
  );

  const { help } = decode(output);
  assert.ok(
    help.some((line) => line.includes("linear-axi statuses list --team ENG")),
    output,
  );
  assert.ok(
    help.some((line) => line.includes("linear-axi issues view LIN-7")),
    output,
  );
});

test("comments create rejects --body together with --body-file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "linear-axi-body-"));
  const bodyFile = join(dir, "body.md");
  await writeFile(bodyFile, "From file", "utf8");
  const calls = [];

  expectFailure(
    await cli(
      ["comments", "create", "--issue", "LIN-1", "--body", "Inline", "--body-file", bodyFile],
      runtime({
        callTool: async (name) => {
          calls.push(name);
          return { structuredContent: { identifier: "LIN-1" } };
        },
      }),
    ),
    2,
    /--body/,
  );
  assert.ok(!calls.includes("save_comment"));
});

test("cycles list resolves team keys to ids and omits type for --type all", async () => {
  const calls = [];
  const client = runtime({
    callTool: async (name, args) => {
      calls.push({ name, args });
      if (name === "get_team") return { structuredContent: { id: "team-uuid", key: "ENG" } };
      return { structuredContent: { cycles: [{ id: "c1", number: 3, name: "Sprint 3" }] } };
    },
  });

  await ok(["cycles", "list", "--team", "ENG", "--type", "all"], client);
  assert.deepEqual(calls, [
    { name: "get_team", args: { query: "ENG" } },
    { name: "list_cycles", args: { teamId: "team-uuid" } },
  ]);

  calls.length = 0;
  await ok(["cycles", "list", "--team", "ENG", "--type", "current"], client);
  assert.deepEqual(calls.at(-1), {
    name: "list_cycles",
    args: { teamId: "team-uuid", type: "current" },
  });
});

test("documents list filters by resolved project id", async () => {
  let listed;
  await ok(
    ["documents", "list", "--project", "Roadmap"],
    runtime({
      listTools: async () => [{ name: "get_project" }, { name: "list_documents" }],
      callTool: async (name, args) => {
        if (name === "get_project") {
          return { structuredContent: { id: "project-uuid", name: "Roadmap" } };
        }
        listed = { name, args };
        return { structuredContent: { documents: [] } };
      },
    }),
  );

  assert.deepEqual(listed, {
    name: "list_documents",
    args: { projectId: "project-uuid", limit: 50 },
  });
});

test("unknown top-level commands exit 2 and point at help without MCP calls", async () => {
  let called = false;

  const output = expectFailure(
    await cli(
      ["releases", "list"],
      runtime({
        callTool: async () => {
          called = true;
          return {};
        },
      }),
    ),
    2,
    /unknown command: releases/,
  );

  assert.match(output, /code: VALIDATION_ERROR/);
  assert.match(output, /Run `linear-axi --help`/);
  assert.equal(called, false);
});

test("unsupported subcommands use generic unknown-subcommand handling without MCP calls", async () => {
  let called = false;
  const client = runtime({
    callTool: async () => {
      called = true;
      return {};
    },
  });

  expectFailure(
    await cli(["statuses", "save", "--type", "project", "--project", "Roadmap"], client),
    2,
    /unknown statuses command: save/,
  );
  expectFailure(
    await cli(["statuses", "delete", "--type", "project", "--id", "status-id"], client),
    2,
    /unknown statuses command: delete/,
  );
  expectFailure(
    await cli(["issues", "save", "--title", "Task"], client),
    2,
    /unknown issues command: save/,
  );
  expectFailure(
    await cli(["projects", "save", "--name", "Roadmap"], client),
    2,
    /unknown projects command: save/,
  );
  expectFailure(
    await cli(["documents", "save", "--title", "Spec"], client),
    2,
    /unknown documents command: save/,
  );
  expectFailure(
    await cli(["comments", "save", "--issue", "LIN-1"], client),
    2,
    /unknown comments command: save/,
  );
  expectFailure(
    await cli(["milestones", "save", "--project", "Roadmap"], client),
    2,
    /unknown milestones command: save/,
  );

  assert.equal(called, false);
});

test("mcp-shaped tools command is not public cli", async () => {
  expectFailure(await cli(["tools", "list"], runtime({})), 2, /unknown command: tools/);
});

async function waitFor(predicate) {
  const started = Date.now();
  while (Date.now() - started < 3000) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timed out waiting for condition");
}

// Drives the real entry point the way bin.ts does and captures everything a caller would see.
async function cli(args, overrides = {}) {
  const stdout = [];
  const stderr = [];
  const originalExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    await main(args, {
      cwd: process.cwd(),
      env: { LINEAR_AXI_MCP_URL: "https://mcp.linear.app/mcp" },
      stdout: { write: (text) => stdout.push(text) },
      stderr: { write: (text) => stderr.push(text) },
      ...overrides,
    });
    return { output: stdout.join(""), stderr: stderr.join(""), exitCode: process.exitCode ?? 0 };
  } finally {
    process.exitCode = originalExitCode;
  }
}

async function ok(args, overrides = {}) {
  const result = await cli(args, overrides);
  assert.equal(result.exitCode, 0, result.output);
  return result.output;
}

function expectFailure(result, exitCode, pattern) {
  assert.equal(result.exitCode, exitCode, result.output);
  assert.match(result.output, /^error: /m);
  assert.match(result.output, pattern);
  return result.output;
}

function runtime({ cwd, env, ...client }) {
  return {
    cwd: cwd ?? process.cwd(),
    env: { LINEAR_AXI_MCP_URL: "https://mcp.linear.app/mcp", ...env },
    client: { close: async () => {}, ...client },
  };
}

async function makeNoGitTempDir() {
  for (const parent of [tmpdir(), "/var/tmp", "/dev/shm"]) {
    if (await hasGitAncestor(parent)) continue;
    try {
      return await mkdtemp(join(parent, "linear-axi-no-git-"));
    } catch {
      // Try the next conventional temp directory.
    }
  }
  return null;
}

async function hasGitAncestor(path) {
  let current = resolve(path);
  while (true) {
    try {
      await stat(join(current, ".git"));
      return true;
    } catch {
      // Keep walking.
    }
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}
