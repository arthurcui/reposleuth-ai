# RepoSleuth AI

Autonomous GitHub Issue & Code Investigator. Local, read-only investigation of
public repositories with source evidence and actionable engineering reports.

**Current checkpoint: Stage 4 — investigation user experience.** Submit a public
GitHub repository and question, follow live tool activity, and inspect reports with
line-numbered evidence, confidence, uncertainty, and proposed fixes. The backend
persists reports, usage, and progress in SQLite. A clearly labeled synthetic demo
works without credentials or paid requests. Successful live model verification
still awaits API credits (see verification below).
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

This runs TypeScript checks, ESLint, Vitest API and React interaction tests, and
production builds. Tests need no external APIs or paid calls.

## Investigation workspace (Stage 4)

1. Open http://127.0.0.1:5173 and enter a public GitHub URL or `owner/repository`.
2. Optionally enter an issue number, then describe what to investigate.
3. Select **Investigate** to start a bounded, billable API run. Watch the activity
   timeline, elapsed duration, input/output tokens, and estimated cost. **Stop
   investigation** requests cancellation; already submitted requests may incur cost.
4. Review the report, expand source evidence, and use immutable GitHub links to
   inspect the cited commit. Suggestions and test plans have not been executed.

The URL stores the investigation ID, so refreshing or reopening that URL restores
the persisted result on the same local server. SSE reconnects replay events and
status polling provides a fallback. Closing the tab does not cancel work.
Quota, budget, cancellation, timeout, and interrupted states are displayed explicitly.
Missing token usage is labeled incomplete with the reserved amount shown.

Choose **Explore free demo**, or open http://127.0.0.1:5173/?investigation=demo,
to view synthetic N+1 findings without any API calls. Demo paths and commit IDs are
illustrative and deliberately have no external source links. Source and report
text is rendered as escaped React text; credentials remain on the server.

`npm run build` creates each application's `dist/`. Run the compiled backend with
`npm start -w @reposleuth/api`. Production UI hosting and Docker integration are
planned for Stage 5; use `npm run dev` for the integrated UI/API checkpoint.

## Layout

```text
apps/api/          Fastify backend and integration tests
apps/web/          React/Vite frontend
packages/shared/  Shared runtime schemas and TypeScript types
```

## Inspect a public repository (Stage 2)

```sh
npm run inspect -w @reposleuth/api -- octocat/Hello-World
npm run inspect -w @reposleuth/api -- owner/repo 42
```

The second form retrieves issue 42 and its first 20 comments. A pull request number
is rejected. A GitHub HTTPS repository URL is also accepted. Public repositories
work without a token, subject to GitHub's unauthenticated rate limit. Optional
`GITHUB_TOKEN` belongs only in root `.env.local`; use read-only contents/issues
permissions. This CLI never uses the OpenAI key.

The `RepositoryProvider` interface exposes `getIssue`, `listFiles`, `searchCode`,
`readFile`, `getCommits`, and `getFileDiff`. Instantiate `OctokitProvider.connect`
once per investigation. It resolves the default branch once, pins the commit and
tree SHAs, and reads blobs from that tree. History is anchored to the same commit.
Diffs accept only commits returned by `getCommits` for the requested path. The
provider makes GET requests only and never clones or executes repository code.

Issues/comments are live metadata with a retrieval timestamp, not historical
content pinned to a source commit. Diffs are historical context; use `readFile`
for exact source evidence. Line numbers are one-based. Reads clamp the end at EOF
and reject a start beyond EOF, including empty files.

Limits per provider instance:

| Resource | Limit |
| --- | --- |
| Eligible tree entries / returned paths | 5,000 / 500 |
| Individual source file | 128 KiB, UTF-8 only |
| Search index | First 40 eligible paths in sorted order, at most 2 MiB |
| Search | Literal, case-sensitive, 2–200 characters; 30 matching lines |
| Source read | 200 lines and 24,000 characters |
| Issue comments / field text | 20 / 8,000 characters |
| File history / diff pagination | 10 commits / 300 changed files |
| Network | 2 setup requests + up to 55 operation requests; 15-second request timeout |

Search indexes are in memory and cached per instance. Binary files, symlinks,
submodules, dependency/build directories, env files, lockfiles, and common binary
extensions are excluded. Truncation and exclusions are returned as explicit warnings;
an empty search is not proof a symbol is absent from the repository. GitHub-truncated
trees are not expanded with unbounded follow-up requests. API failures use sanitized
error codes, including rate-limit/access denial and exhausted request budget.

Stage 2 uses mocked HTTP fixtures for all six operations and error/boundary cases.
A live unauthenticated smoke check also exercised discovery, reading, search,
history, and diffs on `octocat/Hello-World` at commit
`7fd1a60b01f91b314f59955a4e4d4e80d8edf11d`. Live checks are not part of `npm test`.

## Cost and safety

The agent never executes shell commands, modifies repository files, or creates PRs.
Evidence validation checks the SHA, path, inclusive line range, exact quote, and
finding references against source actually read in that run. This verifies citation
integrity, not the correctness of a root-cause hypothesis. Confidence is qualitative.
Tests are proposed, never executed by the agent. Repository content remains untrusted.

## Run an investigation (Stage 3)

Save `OPENAI_API_KEY` in root `.env.local`, then run `npm run dev`. The backend
loads the key server-side only. Starting the server or checking health costs nothing;
submitting an investigation makes paid API requests. Without a key, POST returns 503.

PowerShell example using a small public repository:

```powershell
$body = @{
  repository = 'octocat/Hello-World'
  question = 'Inspect the repository and explain whether there is enough source code to investigate a defect. Do not invent a defect.'
} | ConvertTo-Json
$run = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3001/api/investigations' -ContentType 'application/json' -Body $body
Invoke-RestMethod "http://127.0.0.1:3001/api/investigations/$($run.id)"
```

For an issue investigation, add `issueNumber` with a real issue number in that public
repository. `owner/repo` and `42` in architectural examples are placeholders.

| Endpoint | Behavior |
| --- | --- |
| POST `/api/investigations` | Validate input and return 202 with queued run ID |
| GET `/api/investigations/:id` | Status, report, revision, duration, token usage, estimated cost |
| GET `/api/investigations/:id/events` | SSE progress; reconnect with Last-Event-ID or `?after=ID` |
| POST `/api/investigations/:id/cancel` | Cancel queued/running work |
| GET `/api/health` | Service health; does not verify API access or balance |

SSE emits queued, started, revision, tool_started, tool_finished, usage, validating,
and terminal events. These contain tool names/outcomes, not raw tool inputs, source,
model reasoning, or upstream errors. Disconnecting SSE does not cancel a run. Streams
close on terminal state; slow consumers reconnect using their last received event ID.

One investigation runs at a time, with at most five queued/running runs. Terminal
states are completed, failed, budget_exceeded, cancelled, timed_out, and interrupted.
On restart, unfinished runs become interrupted rather than silently rerunning paid work.
Data lives in ignored `data/investigations.sqlite`. Run only one backend process per
database. Local API access is unauthenticated: use only on a trusted machine. The
server binds loopback and rejects nonlocal Host and unapproved browser Origin headers.

### Budgets and model

The default model is `gpt-6-luna` with low reasoning effort, standard processing,
remote tracing disabled, response storage disabled, and automatic model retries disabled.
Public source excerpts and the investigation question are sent to OpenAI for inference.
The model is fixed in code so changing it requires reviewing its pricing and behavior.

Per run: 12 model requests, 24 tool calls, 100,000 total reported tokens, 2,000 output
tokens per request, 80,000 estimated input tokens per request, a 120-second deadline,
and a US$0.05 estimated cost ceiling. A timed-out model request may still have incurred
charges. In-flight GitHub requests may finish after cancellation, but no further model
request or report publication is allowed for that run.

Before each call, the app estimates input tokens conservatively from serialized UTF-8
bytes plus overhead and reserves that cost plus the maximum output allowance. This is
an application safeguard, not an exact tokenizer or billing guarantee. Reported token
usage is accumulated after responses; missing usage leaves `usageIncomplete: true`
and a nonzero `reservedCostUsd`. `estimatedCostUsd` uses recorded token counts at
conservative rates and is not an invoice amount.

Rates checked 2026-10-22: standard input US$0.10, cache writes US$0.125, output US$0.50
per million tokens. Budget calculations price all input at US$0.125 to allow for cache
writes. See [official model pricing](https://developers.openai.com/api/docs/models/gpt-6-luna).

`APP_BUDGET_USD` defaults to US$1 and supports values above zero up to US$5. The SQLite
ledger reserves cost atomically and never refunds reservations, even on success. It
therefore stops conservatively, persists across restarts, and is separate from your
OpenAI account balance. Deleting the database removes this safeguard's history. Keep
auto-reload disabled in your billing settings if you do not want automatic purchases.

### Verification

`npm run check` uses a deterministic fake model through the real Agents SDK loop and
makes no paid calls. It covers citation rejection, usage aggregation, budget failures,
cancellation, timeout, restart recovery, SSE replay, and local API access checks.

An explicit opt-in live smoke test uses synthetic source and the real model:

```sh
npm run smoke:agent -w @reposleuth/api -- --live
```

This test has a US$0.02 estimated per-run ceiling and a separate persistent US$0.05
reservation ledger in `data/live-smoke.sqlite`. It prints only run status and usage;
inspect the database for the persisted report. It does not access or modify GitHub.

Current live verification: the API was reached, but returned HTTP 429 with
`credit_balance_exhausted` / `insufficient_quota`. Successful live report generation
remains unverified. The app now classifies this as `OPENAI_QUOTA`, distinct from
`OPENAI_RATE_LIMIT`. Add credits through your API billing settings and rerun the
explicit smoke command when ready. Failed attempts retain a conservative reservation;
zero reported tokens does not imply a verified zero invoice charge.
