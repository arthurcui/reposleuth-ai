# Code structure and testing

Runtime code, automated tests, and evaluation commands have separate directories.
File-header comments explain each source file's purpose; comments inside functions
should explain constraints or decisions rather than repeat the code.

```text
apps/api/
  src/
    agents/          Model configuration, prompts, tools, and budget enforcement
    github/          Repository interface, GitHub implementation, source indexing
    routes/          HTTP endpoints and event streams
    services/        Investigation lifecycle and evidence validation
    storage/         SQLite persistence
    app.ts           Application assembly
    server.ts        Server entry point
  cli/               Read-only repository inspection command
  evaluation/
    benchmarks/      Public-repository benchmark runner
    replay/          Synthetic corpus replay, live evaluation, and human review
    smoke.ts         Explicitly opted-in live model smoke check
  tests/
    unit/            Focused budget, validation, and evaluation-helper tests
    integration/     Agent, service, GitHub adapter, and HTTP integration tests
    fixtures/        Shared repository/model doubles and fixed responses
apps/web/
  src/
    features/
      investigations/ API client and engineering report rendering
      demo/           Illustrative cases and case-specific explanations
    App.tsx           Workspace state, form, activity, and navigation
    main.tsx          Browser entry point
    styles.css        Shared presentation
  tests/
    unit/             Client and demo data tests
    integration/      React interaction tests
packages/shared/src/  Validated contracts and shared synthetic case definitions
scripts/              Deployment smoke check
benchmarks/           Public benchmark manifest
```

## Dependencies and test placement

- Keep runtime source independent of `tests/` and `evaluation/`. The API imports
  shared contracts; the browser never imports backend implementation code.
- Put focused tests under `tests/unit/`, mirroring the relevant domain directory.
  Put tests that connect components under `tests/integration/`.
- Keep reusable test doubles under `tests/fixtures/`. Integration tests use fake
  models, mocked GitHub responses, temporary files, or in-memory databases; they
  do not require credentials or paid calls.
- Evaluation commands may import runtime code and test fixtures. They are separate
  from the production server entry point and default test discovery. Live model
  evaluations require explicit CLI opt-in and may incur charges.
- Add a brief purpose header to new authored source and test files. Keep the
  `@vitest-environment jsdom` directive first in browser interaction tests.
- JSON configuration stays standard JSON; its role is described here rather than
  adding unsupported comments.

## Everyday checks

```sh
npm run format         # Apply consistent code formatting
npm run check          # Formatting, types, lint, all tests, production builds
npm test -- apps/api/tests/unit
npm test -- apps/web/tests/integration
npm run eval           # Credential-free scripted replay of the 20 cases
npm run benchmark -- --list
```

Type checking includes tests, CLI tools, and evaluations. Build entry points remain
`apps/api/src/server.ts` and `apps/web/src/main.tsx`; moving a test does not add it to
the production bundle. Formatting excludes dependencies, build outputs, local data,
and the generated lockfile. Local benchmark results and private answer keys remain
under ignored `data/`.
