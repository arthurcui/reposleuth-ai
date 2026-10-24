# RepoSleuth AI — incremental implementation

Each stage ends with a runnable checkpoint. Complete its checks before moving on.
The MVP remains local, public-repository-only, and read-only. No repository writes,
shell tools, PRs, vector database, or multi-agent orchestration.

## Stage 1 — Foundation

Status: complete. Verified with `npm run check` (two API integration tests),
compiled API health, Vite proxy health, and frontend HTML over localhost.
Dependency audit reported zero vulnerabilities. No OpenAI requests were made.
Browser visual verification has not been performed.

Deliver npm workspaces with React/Vite, Fastify, shared Zod contracts, TypeScript,
ESLint, Vitest, environment examples, and setup documentation.

Acceptance:
- `npm run check` passes: types, lint, tests, and both builds.
- `npm run dev` serves the UI and `/api/health` through the Vite proxy.
- Health returns only service status; credentials remain on the backend.
- Development and checks make no OpenAI requests.

## Stage 2 — Read-only GitHub integration

Status: implemented. The Octokit adapter and inspection CLI provide all six
read-only operations. Fixture-backed tests cover pinning, input validation,
private-repository rejection, content/output limits, partial search, errors, and
bounded pagination. A live unauthenticated public-repository smoke check passed
for discovery, source reading, search, history, and diffs. Issue retrieval is
verified by deterministic fixtures. UI integration remains in Stage 4.

Implement a RepositoryProvider interface and an Octokit adapter. Validate GitHub
repository URLs and owner/repo input. Reject private repositories. Resolve a commit
SHA once per investigation and pin source retrieval to it. Read issues and bounded
comments, trees, files, recent commits, and file diffs. Build bounded local literal
source search, with file-size limits, exclusions, and explicit truncation notices.

Acceptance:
- Fixture-backed tests cover all six provider operations and GitHub errors.
- Search and reads return exact paths and line numbers at the pinned SHA.
- Oversized/binary files, invalid paths/ranges, and truncated trees are handled.
- No provider operation writes to GitHub or executes repository code.

## Stage 3 — Agent engine and durable API

Status: implemented; successful live verification is blocked by exhausted API credit.
The real Agents SDK loop passes deterministic fake-model tests, with citation
validation, SQLite state and events, SSE replay, cancellation, restart recovery,
request/token/tool/deadline limits, and persistent cost reservations. Type checks,
lint, tests, and production builds pass. The bounded live fixture test reached
OpenAI but returned HTTP 429 with `credit_balance_exhausted` / `insufficient_quota`.
No live report or billed-token measurement was obtained. Rerun the opt-in smoke
test after API credits are available before marking this acceptance check complete.

Use the OpenAI Agents SDK with six Zod-validated tools: get_issue, list_files,
search_code, read_file, get_commits, and get_file_diff. Add bounded turns, total
tool calls, input/output tokens, timeouts, cancellation, and a conservative cost
budget before live testing. Select and document a low-cost model and its rates.
Disable remote tracing by default; local events must omit credentials.

Persist investigation state, events, usage, and reports in SQLite. Implement POST
/api/investigations (202), GET /api/investigations/:id, and SSE events. Define
structured reports with summary, findings, evidence, recommendations, risks, and
unresolvedQuestions. Check citations against retrieved source at the pinned SHA.
Treat all repository content as untrusted input; separate facts from hypotheses.

Acceptance:
- Deterministic fake-model tests exercise iterative tool selection and final output.
- Invalid citations cannot become validated evidence.
- Budget exhaustion and failures persist explicit terminal states.
- SSE reconnects replay events; restart recovery marks interrupted runs clearly.
- Usage aggregates all requests; no test results are invented.
- One tightly bounded live smoke test is reported with actual usage and cost.

## Stage 4 — Investigation user experience

Status: implemented. The React workspace supports submission, live SSE activity
with polling fallback, cancellation, URL-based recovery, token/cost/duration metrics,
terminal-state guidance, and evidence reports with immutable GitHub links.
A labeled synthetic demo makes no API requests. All 65 tests, type checks, lint,
and production builds pass. UI tests cover submission, cancellation, refresh,
quota failures, a terminal-event race, source escaping, and link validation.
Empty/non-JSON proxy responses show connection guidance. Requested issues are
checked before model calls; missing issues fail without token usage or reservations.
The demo was visually inspected in the browser's narrow panel; a wide-screen
visual check remains pending. Successful real-model end-to-end verification
remains blocked by the Stage 3 API credit shortage; fixture results are not a
substitute for that acceptance check.

Build repository/issue selection, question submission, live timeline, duration and
token usage, evidence viewer, and final report. Link evidence to immutable GitHub
commit URLs. Display confidence, uncertainty, missing evidence, and proposed fixes.

Acceptance:
- A user can start and follow a real investigation end to end.
- Refresh restores status; failures and budget limits have clear UI states.
- Accessible controls and responsive layout work on narrow and wide screens.
- No secret reaches the browser; rendered issue/source content is escaped.

## Stage 5 — Reliability, evaluation, and demo

Status: implementation complete; real-model acceptance targets remain pending.
Added 20 distinct synthetic cases across all six defect families, SDK/service
replay evaluation, per-case reports and timing, negative citation tests, and a
human-review grader that rejects replay as accuracy evidence. Live evaluation is
explicitly opt-in, separately budgeted, and was not run due to the prior credit
shortage. Rate-limit/no-retry, late preflight completion, and production hosting
tests are included. Type checks, lint, tests, and builds pass locally and in the
Linux Docker build. The Docker container became healthy and its credential-free
deployment smoke passed. Compose publishes only loopback:5174 and retains a data
volume. GitHub Actions configuration is added; remote CI awaits publication.

Measured scripted replay: 20/20 completion, all 20 reports citation-valid, zero
forbidden tool calls, 194 ms total / 12 ms p95 locally, $0 external API cost.
These are pipeline checks with scripted answers, not model accuracy or latency.
Live 95% completion, 80% root-cause accuracy, and <90-second targets are not claimed.
See `docs/evaluation.md` for independent review and `docs/architecture.md` for
data flow, deployment, and operating boundaries.

The browser demo now uses the shared 20-case corpus with a grouped selector and
URL-based selection recovery. The two demo banners identify the reports as
illustrative. Demo commits, duration, token counts, and cost are fictional
presentation values, not measured model usage. Cases have distinct risks,
questions, uncertainties, and proposed code with explanations. Several cases
include two or three exact source excerpts with numbered evidence links.

Add deterministic bug fixtures (N+1, stale state, missing await, cache invalidation,
races, pagination), integration tests, rate-limit/retry coverage, Docker, and CI.
Prepare at least 20 curated cases with expected root causes and supporting files.
Document architecture, operating limits, and a reproducible demo.

Acceptance targets (must be measured, not assumed):
- 100% of citations have valid paths/ranges at the pinned commit.
- Zero unauthorized writes.
- At least 95% completion and 80% root-cause accuracy on the fixed evaluation set.
- Target under 90 seconds for small repositories; report actual timing and cost.
- Docker demo and CI pass without credentials for deterministic tests.

## Beyond the MVP

Only after evaluation: human-reviewed patch proposals, sandboxed test execution,
additional MCP providers, and repository intelligence if bounded search is inadequate.
