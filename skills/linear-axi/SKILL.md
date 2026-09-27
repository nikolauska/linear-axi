---
name: linear-axi
description: "Operate Linear through the linear-axi CLI - issues, projects, teams, users, comments, documents, milestones, cycles, statuses, labels, auth, and repo project setup. Use whenever a task touches Linear: listing or creating issues, updating project work, reading documents, or managing comments. Do not use for non-Linear issue trackers."
---

# linear-axi

Agent ergonomic wrapper around the configured Linear MCP server. Prefer this over raw Linear MCP calls for Linear operations.

Check whether `linear-axi` is installed before using it. If it is missing, ask the user to install the standalone CLI globally with `npm install -g @nikolauska/linear-axi` (Node.js 24 or newer).

## When to use

Use linear-axi whenever a task touches Linear: issues, projects, documents, comments, milestones, cycles, statuses, labels, teams, users, or binding the current repo to a default Linear project.

## How to use

The CLI documents itself; read its help instead of guessing flags:

- `linear-axi` shows a dashboard for the current repo with the next useful commands.
- `linear-axi --help` lists commands and global flags.
- `linear-axi <command> --help` lists subcommands; `linear-axi <command> <subcommand> --help` lists every accepted flag and explains defaults such as the repo project binding.
- Responses and errors include `help:` hints when there is a useful next step, such as authorizing, choosing a project, or continuing a paginated list; follow them.

## Commands

```
commands[13]:
  (none)=dashboard, init, auth, issues, projects, teams, users, comments, documents, milestones, cycles, statuses, labels
```

## Rules

- Never print bearer-token environment variables or OAuth tokens.
- Before a destructive or broad mutation, verify the target and ask for confirmation unless the user already requested that exact change.
