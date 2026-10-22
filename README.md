# RepoSleuth AI

Autonomous GitHub Issue & Code Investigator. Local, read-only investigation of
public repositories with source evidence and actionable engineering reports.

**Current checkpoint: Stage 1 — foundation.** The app provides a local health check
and a UI shell. It does not yet retrieve repositories or run AI investigations.
See [the staged implementation plan](IMPLEMENTATION_PLAN.md) for acceptance checks.

## Requirements

- Node.js 22.13+, 24.x, or 26+ and npm (Node 24 LTS recommended).
- Network access to npm for installing dependencies.
- No GitHub or OpenAI credentials required for Stage 1.

## Run locally

From this workspace:

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5173. The API binds to http://127.0.0.1:3001 and the UI proxies
`/api` to it. Both services bind only to loopback. Stop them with Ctrl+C.

Root `.env.local` is loaded only by the backend. If it does not exist, copy
`.env.example` to `.env.local` and edit it locally. Never overwrite an existing
credential file. Never prefix secrets with `VITE_` or commit env files. The Vite
configuration reads only PORT from the root environment for its development proxy.
Health responses contain no configuration values or secrets.

## Verify

```sh
npm run check
```

This runs TypeScript checks, ESLint, Vitest API integration tests, and production
builds. Tests use Fastify injection and need no external APIs or paid calls.

`npm run build` creates each application's `dist/`. Run the compiled backend with
`npm start -w @reposleuth/api`. Production UI hosting and Docker integration are
planned for Stage 5; use `npm run dev` for the integrated UI/API checkpoint.

## Layout

```text
apps/api/          Fastify backend and integration tests
apps/web/          React/Vite frontend
packages/shared/  Shared runtime schemas and TypeScript types
```

## Cost and safety

Stage 1 performs no model calls. Later stages will enforce bounded investigations,
keep credentials server-side, pin evidence to commit SHAs, and expose usage. The
agent will not execute shell commands, modify repository files, or create PRs.
Confidence in a hypothesis will not imply a tested or confirmed root cause.
