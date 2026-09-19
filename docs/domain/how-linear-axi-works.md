# How linear-axi works

linear-axi is an [Agent eXperience Interface (AXI)](https://github.com/kunchenguid/axi) for Linear. It gives AI agents a command-line interface for working with Linear through a configured MCP endpoint.

AXI tools are designed for AI agents rather than human-first terminal use. linear-axi turns Linear operations into compact, resource-based commands with structured output, predictable errors, and contextual next steps.

## Install linear-axi

linear-axi requires Node.js 24 or newer. Install the command globally with npm:

```sh
npm install -g @nikolauska/linear-axi
```

Confirm that the command is available:

```sh
linear-axi --help
```

The CLI connects to the configured Linear MCP endpoint. When the default endpoint requires authorization, sign in with:

```sh
linear-axi auth login
```

For agent-specific setup and usage, see the [linear-axi skill](../../skills/linear-axi/SKILL.md).

## Connect to Linear

The CLI uses the configured Linear MCP endpoint. The default endpoint supports OAuth login, while custom endpoints can use a bearer token when required.

After authentication, commands run against the Linear workspace associated with those credentials.

## Choose the working scope

An AI agent can bind a Git repository to a default Linear project. linear-axi validates that project against the authenticated workspace before saving or using it.

Project-scoped commands use the repository’s default project unless the agent selects another project for a command. Issue and document lists can also be run explicitly across all projects.

This keeps routine work focused on the project associated with the current repository without preventing broader workspace searches.

## Work with Linear resources

Commands are grouped by the Linear resource they affect. AI agents can:

- list, view, create, and update issues;
- list, create, and update projects;
- list and create comments;
- list, view, create, and update documents;
- list, view, create, and update milestones;
- inspect cycles, teams, users, statuses, and labels.

List commands support filtering, selected fields, pagination, and full-detail output where applicable.

## Read results and recover from errors

linear-axi returns compact, structured output designed to reduce the tokens an AI agent needs to understand and act on Linear data. Large responses are summarized by default, while full output can be requested when needed.

When more results are available, the response includes a cursor and a command for continuing. Validation and operational errors include practical recovery suggestions, such as selecting a project, correcting a command, authenticating, or inspecting an existing resource before retrying a change.
