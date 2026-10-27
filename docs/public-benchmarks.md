# Public project benchmarks

These are runnable, deliberately defective applications, separate from RepoSleuth's
prewritten demo and scripted replay tests. Each baseline contains five independently
reproduced defects and five symptom-only GitHub issues. A live benchmark uses real
GitHub retrieval and real model calls; no expected diagnosis is passed to the model.

| Application | Repository / issues | Local requirements |
| --- | --- | --- |
| Support Desk API | [Node.js / TypeScript](https://github.com/arthurcui/reposleuth-bench-node-api), [issues](https://github.com/arthurcui/reposleuth-bench-node-api/issues) | Node 24+, npm; port 4311 |
| Booking Desk | [C# / ASP.NET Core](https://github.com/arthurcui/reposleuth-bench-dotnet), [issues](https://github.com/arthurcui/reposleuth-bench-dotnet/issues) | .NET SDK 10; port 4312 |
| Operations Dashboard | [React / TypeScript](https://github.com/arthurcui/reposleuth-bench-react), [issues](https://github.com/arthurcui/reposleuth-bench-react/issues) | Node 24+, npm; port 4313 |

All three are public, use fictional data, and have a `baseline-v1` tag. Follow each
README to run it locally. The investigator only reads source: running the target
applications is **not** necessary to investigate their issues. Avoid fixing or moving
baseline tags; create a new version and manifest when extending the corpus.

## Investigate in the browser

Enter a repository URL above, issue number 1–5, and a request such as
"Investigate issue #1, find the cause, and recommend a fix with source evidence."
Use a live investigation, not demo mode. The normal UI pins the default branch at
run start; use the runner below for comparisons at the exact baseline SHA.

## Benchmark runner

```sh
npm run benchmark
npm run benchmark -- --verify
```

The first command lists cases without network access. `--verify` makes read-only
GitHub requests to check pinned revisions and issue availability; it never calls
a model. Both modes omit private answers. The manifest is
`benchmarks/public-projects.json`; IDs case-01 through case-05 target Node,
case-06 through case-10 target .NET, and case-11 through case-15 target React.

Verification reuses each repository/revision connection: this 15-case suite takes
21 GitHub requests when the issues have no comments. Partial progress is saved to
`data/benchmarks/results/<run-id>.verify.json`. A GitHub 403/429 can indicate a rate
limit or access denial, not a model failure. Avoid repeated retries; wait for reset
or configure `GITHUB_TOKEN` locally with read access to these public repositories.
Verify a single case with `npm run benchmark -- --verify --case case-01` when needed.

To run a **real, potentially billable** investigation using the configured
`LLM_PROVIDER` and corresponding backend key:

```sh
npm run benchmark -- --live --case case-01 --max-usd 0.10
```

After inspecting the first report, an explicitly requested suite run is:

```sh
npm run benchmark -- --live --all --max-usd 1
```

The selected provider uses the same service, tools, evidence validator, and per-run
limits as the app. The separate persistent ledger in
`data/benchmarks/results/live-budget.sqlite` counts conservative reservations across
invocations and providers. `--max-usd` is its total ceiling, not new credit; the
default is $0.10 and maximum $1. A run stops on the first unsuccessful case and
never retries automatically. Do not delete the ledger to bypass spending controls.
No live benchmark was run while creating this initial corpus.

Each run saves a unique JSON result containing the model, source SHA, issue snapshot
and hash, report, usage, duration, status, and limits. Completed cases are checkpointed
before proceeding. If a suite stops early, unattempted cases remain listed under
`planned`; they are not silently counted as successes. Expected answers are never
read by this runner. Results and ledgers are ignored by Git and excluded from Docker.

`INVALID_EVIDENCE` means a generated report failed exact source validation, not that
GitHub or the model connection failed. New results include `validationDiagnostics`
with a reason (quote mismatch, source not read, commit mismatch, invalid range,
duplicate ID, or unknown evidence reference) and a one-based evidence index when
applicable. Raw rejected text is not logged or accepted as a report. Older results
without diagnostics cannot identify the precise mismatch retrospectively.

## Independent review and fair comparison

Independent human review can provide additional confidence, but is not required
to use the automated grader below. AI judgments are labeled separately and never
reported as independent human validation.

The private answer key and reproduction checks are kept locally under the ignored
`data/benchmarks/private/` directory, outside all three published repositories.
It includes causes, fixes, exact source references, expected observations, and
uncertainty. It is not backed up by Git; maintain a private backup separately.
Do not publish keys, reference fixes, answer-bearing test names, or reviewer comments
to the benchmark repositories' source, issues, or histories.

For each report, independently score these fields and record a rationale:

- Root-cause correctness: identifies the actual mechanism, not merely the symptom.
- Evidence support: relevant exact code supports the causal explanation.
- Fix quality: addresses that mechanism without a material new regression.
- Uncertainty and false claims: distinguishes inferred behavior from executed tests.

Keep the saved run ID and case ID in each review. Report completion and correctness
over **all planned cases**, alongside latency, tokens, and estimated cost. Citation
validation alone is not accuracy. Use the same manifest, issue hashes, limits, and
tool policy for both models; repeat runs to measure variability. The 15 seeded
defects establish a starting corpus, not a production-accuracy claim. Add clean
controls and insufficient-information cases in a later corpus version to measure
false-positive behavior.

## Initial verification

All three applications build. Separate private checks reproduce all ten backend
symptoms via actual HTTP requests and all five frontend symptoms through React
component interaction tests. These checks assert the observed defective behavior;
they are not passing correctness tests and do not establish model performance.

## Automated grading

Run the offline checks over saved CLI results and application-history runs:

```sh
npm run benchmark:grade
```

This does not launch investigations, load provider credentials, or make model/network
requests. It deduplicates run IDs, retains failed attempts, and lists missing case coverage.
Private answers are read only by this evaluation command, never by the investigator or
web application. Pinned source is read from local Git objects under
`data/benchmarks/repos/`; missing revisions produce an unverified result, not a pass.
The private answers must match the public manifest and their cited source lines.

Outputs are new, ignored folders under `data/benchmarks/reviews/automated-<id>/`:
`grades.json` contains individual checks/judgments and `scorecard.csv` is a compact table.
Original reports and history remain unchanged. Failed reports have no semantic scores;
exact citations without an AI judgment are explicitly **unscored**. A source mismatch
or unavailable snapshot cannot silently pass. Input reports containing malformed schemas
stop the command instead of being silently omitted. Up to 200 saved attempts are accepted.

Optionally evaluate one CLI result file with `--input <result.json>`. Without this option,
the command reads all saved live benchmark JSON results and benchmark-repository runs in
application history. GitHub verification records and synthetic demos are excluded.

For AI semantic scoring, explicitly opt in and set a maximum dollar budget, for example:

```sh
npm run benchmark:grade -- --judge --max-usd 0.10
```

This example is potentially billable. It uses the configured `LLM_PROVIDER`, model and
server credentials, in a separate, tool-free evaluator call. The evaluator receives the
saved question/report, private expected cause/fix and verified source excerpts; these
private inputs are sent to the selected provider only with `--judge`. It scores root cause,
evidence relevance, fix and uncertainty (0–2), and distinguishes alternative causes from
alternative fixes. Treat scores as AI-assisted judgments, not ground truth or executed tests.
A diagnosis pass requires scores of 2 for cause, evidence and fix. Deep coverage is reported
separately, so a correct diagnosis can still have a depth gap.

Uncertain judgments or mechanically detected Deep gaps trigger at most one additional
assessment of the original input, without seeing the first judgment. Disagreement remains
uncertain; no human review is required to finish the command. This is a second model call,
not independent human review, and correlated errors remain possible. The evaluator cannot
execute source code or use repository tools. Its source context is bounded to the supplied
excerpts, so it should mark context-dependent conclusions uncertain.

The judge has a separate persistent reservation ledger at
`data/benchmarks/reviews/judge-budget.sqlite`. `--max-usd` must be positive and at most $1;
it caps both this invocation and the ledger's cumulative conservative reservations. It is
not fresh credit on each run. Failed/uncertain calls retain reservations. Grading stops on
a judge failure or budget stop, saves completed grades, and exits unsuccessfully; remaining
run IDs stay listed as planned. Cost estimates use configured model prices, not invoice guarantees.
No automatic fallback, new investigation, or unlimited retry occurs.

Grades record the grader version, answer hash, evaluator model/usage, source commits,
original costs/durations, and judgment-input hashes. New benchmark investigations also
record the investigator prompt version and source-read events with path/range/handle.
Historical runs without path events cannot establish all paths examined; a single cited
path is reported as lack of demonstrated breadth, not proof that only one file was read.

All private answers, saved results and grades remain under Git-ignored `data/`, excluded
from Docker. Do not publish private expected answers into the benchmark repositories.
