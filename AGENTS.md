# AGENTS.md
<!-- agents-md-version: 1 -->

## CRITICAL

- MUST: Use `npm ci` for a clean install; `package-lock.json` mandates npm.
- MUST: Run `npm run check` before committing.
- MUST: Run `npm test` before opening a PR.
- MUST: Use `npm install` or `npm uninstall` to change dependencies; commit both package files.
- NEVER: Use yarn, pnpm, or bun in this repository.
- NEVER: Edit `skills/linear-axi/SKILL.md` directly; run `npm run build:skill` after changing `src/skill.js`.
- NEVER: Run `npm publish` locally; tagged GitHub Actions releases publish the package.
- NEVER: Run `npm run demo` without approval; it creates Linear projects, issues, and comments.
- NEVER: Inspect or log bearer-token values or OAuth credential files.
- NEVER: Force push (`git push --force`, `git push -f`) to shared branches.
- ON FAIL: Read the first complete error before retrying; verify Node.js 20+ and the command recovery below.
- ON FAIL (check): Run the reported syntax check, skill build, or test target directly, fix it, then rerun `npm run check`.
- ON FAIL (test): Run `node --test test/cli.test.js` or the relevant single test file.

## Domain & Context

- Goal: Provide an agent-friendly CLI over Linear MCP operations with compact, actionable output.
- Type: CLI/Tool
- Stack: Node.js ESM using `axi-sdk-js` and `@modelcontextprotocol/sdk`.
- License: MIT
- Key Terms:
  - `AXI`: Agent eXperience Interface; CLI behavior optimized for software agents.
  - `TOON`: Compact structured output rendered by `src/format.js`.
  - Repo project: Linear project binding stored in `.linear-project` at the Git root.

## Data & State

- Repo binding: `.linear-project`, written by `linear-axi init`.
- MCP endpoint: `[mcp_servers.linear].url` in the Codex config, overridden by `LINEAR_AXI_MCP_URL`.
- OAuth state: `LINEAR_AXI_AUTH_FILE` or the user configuration directory; never inspect its contents.
- Generated skill: `src/skill.js` -> `skills/linear-axi/SKILL.md` via `npm run build:skill`.

## Execution Context

- Run on: Host
- Runtime: Node.js 20 or newer.
- External service: Configured Linear MCP endpoint.

## Commands

```bash
# install
npm ci                              # ON FAIL: verify Node.js 20+ and package-lock.json consistency
# test
npm test                            # ON FAIL: run node --test test/cli.test.js first
# test:single
node --test test/cli.test.js        # ON FAIL: inspect the first failing assertion and rerun this file
# check
npm run check                       # ON FAIL: fix the first syntax, generated-skill, or test failure
# generate skill
npm run build:skill                 # ON FAIL: fix src/skill.js, then rerun
# demo (requires approval, vhs, zsh, and Linear auth)
npm run demo                        # ON FAIL: cancel leftover demo resources, then verify vhs and zsh
```

## Structure

```
bin/                    # Executable entrypoints
docs/demo.tape          # Demo recording source
docs/demo.gif           # Generated demo (generated -- do not edit)
scripts/                # Skill generation script
skills/linear-axi/      # Generated agent skill (generated -- do not edit)
src/cli.js              # Runtime and router
src/commands/           # Resource command handlers
src/lib/                # Shared CLI helpers
test/                   # Node test suites
package.json            # Scripts and package metadata
```

## Patterns

- **Module:** Use ESM `import`/`export`; never add CommonJS `require()` to source files.
- **Async:** Use `async`/`await` for asynchronous work.
- **Naming:** Use kebab-case JavaScript filenames, camelCase functions, and UPPER_SNAKE_CASE constants. Tests use `*.test.js`.
- **Commands:** Keep resource routing in `src/commands/`; shared command behavior belongs in `src/commands/shared.js`, lower-level helpers in `src/lib/`.
- **Errors:** Route user-facing failures through `usage` or `normalizeError`; render structured output with `renderToon`.
- **Skill:** Change shared skill content in `src/skill.js`, then regenerate the committed skill.

## Testing Strategy

- Runner: Node.js built-in `node:test` via `npm test`.
- Location: `test/*.test.js`; keep test doubles and helpers local to the relevant file.
- Coverage: No configured threshold.
- Conventions: Test command output and exit behavior through the exported dispatcher or CLI runtime.

## Security

- Never log `LINEAR_AXI_MCP_TOKEN` or `LINEAR_MCP_TOKEN` values.
- Never read OAuth state from `LINEAR_AXI_AUTH_FILE` or the default user configuration directory.
- GitHub Actions publishes with OIDC on version tags; do not add registry tokens to the repository.

## Env

- Node.js: `>=20` from `package.json`; CI uses Node.js 24.
- Optional configuration: `CODEX_CONFIG`, `LINEAR_AXI_AUTH_FILE`, `LINEAR_AXI_MCP_TOKEN`, `LINEAR_AXI_MCP_URL`, `LINEAR_MCP_TOKEN`.
- Local install: `npm ci`.

## Git

- Branch: `main` is the default; no repository-enforced naming convention.
- Commit: Use the observed conventional prefix and imperative subject, such as `feat: add command` or `fix(cli): handle error`.
- Hooks: None configured; run `npm run check` manually before committing.
- PR: Run `npm run check`; include regenerated `skills/linear-axi/SKILL.md` when `src/skill.js` changes.

## CI

- Pushes: `.github/workflows/ci.yml` installs with `npm ci`, checks skill drift, and runs tests on Node.js 24.
- Tags: The release job publishes to npm and creates a GitHub release after tests pass.

## Tool Preferences

| Task | Prefer | Avoid |
|------|--------|-------|
| Search text | `rg` | `grep` |
| List files | `rg --files` | `find` |
| Dependencies | `npm` | yarn, pnpm, bun |
