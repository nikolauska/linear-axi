# AGENTS.md

This repository builds `linear-axi`, an agent-facing CLI over Linear MCP. Work in the repository root. Source is TypeScript ESM (`src/`), command handlers are in `src/commands/`, shared command behavior in `src/commands/shared.ts`, lower-level helpers in `src/lib/`, and tests in `test/`.

## Working on the CLI

- Use Node.js 24+ and npm. Install from the lockfile with `npm ci`; change dependencies with `npm install` or `npm uninstall` and include both `package.json` and `package-lock.json`. Do not use yarn, pnpm, or bun here.
- Follow existing ESM and async/await patterns. Keep TypeScript filenames kebab-case and tests as `*.test.ts`. Route user-facing failures through `usage` or `normalizeError`; render structured output with `renderToon`.
- `src/skill.ts` is the source of the shipped skill. After changing it, run `npm run build:skill` and include the regenerated `skills/linear-axi/SKILL.md`; do not edit the generated file directly.
- Finish requested changes end to end. Exercise the affected behavior with the smallest relevant local check, fix failures caused by the change, and rerun that check. For a focused test use `node --test test/<name>.test.ts`; `npm test` runs all tests. Run `npm run check` before committing and `npm test` before opening a PR. `npm run check` includes formatting, lint, typecheck, generated-skill consistency, and tests. If it fails, address the first reported failure and rerun it.

## State and external effects

- `linear-axi init` writes a `.linear-project` binding at the Git root. The CLI uses a configured Linear MCP endpoint; `LINEAR_AXI_MCP_URL` can override it. Do not inspect or log bearer-token values or OAuth credential files, including `LINEAR_AXI_AUTH_FILE` and the default user configuration directory.
- Local tests are the normal verification path. `npm run demo` is different: it creates Linear projects, issues, and comments. Get approval before running it or other commands that mutate Linear data.
- Do not run `npm publish` locally; tagged GitHub Actions releases publish the package. Do not force-push shared branches.
