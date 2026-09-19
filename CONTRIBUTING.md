# Contributing

linear-axi requires Node.js 24 or newer and uses npm.

## Set up the repository

Install the locked dependencies from `package-lock.json`:

```sh
npm ci
```

Development source runs directly as TypeScript. `npm run build` compiles the JavaScript published from `dist/`.

## Validate changes

Run the relevant focused checks while developing, then run the complete project check before committing:

```sh
npm run build
npm test
npm run check
```

`npm run check` verifies formatting, lint rules, types, the generated skill, and tests.

The committed `skills/linear-axi/SKILL.md` is generated from `src/skill.ts`. Do not edit it directly. After changing the shared skill source, regenerate it with:

```sh
npm run build:skill
```

## Regenerate the demo

The demo requires VHS, zsh, and access to an authenticated Linear workspace. It creates temporary Linear projects, issues, and comments, so only run it when those external changes are intended:

```sh
npm run demo
```

The command builds the project and renders `docs/demo.webm` from `docs/demo.tape` using the local executable.
