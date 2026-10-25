# Reproducible evaluation

## Credential-free checks

```sh
npm ci
npm run check
npm run eval
```

`packages/shared/src/evalCases.ts` contains 20 distinct synthetic defects: three N+1,
three stale-state, four missing-await, three cache-invalidation, four race, and
three pagination cases. Every case supplies a question, supporting source file,
expected cause, proposed correction, and verification rubric. Sources are data;
the evaluator never executes them. Read the corpus to review the assumptions. The
same corpus powers the browser demo selector without model requests. Demo reports
are curated explanations, not stored live investigation results.

Replay runs the real SDK and service with a scripted oracle: get the issue, discover
files, read the source, return the known report. It is a deterministic regression
suite, **not a model accuracy evaluation**. Tests also mutate every case's quote
and require rejection. Each case gets fresh mutable state.

Results go to ignored `data/evals/latest.json` and a unique run-ID JSON file. They
include per-case reports, tool names, status, elapsed time, usage, and rubrics.
Replay tokens/costs inside each case are synthetic SDK inputs; the overall monetary
cost is zero. `rootCauseAccuracy` stays null until independent live-result review.
Failures produce a nonzero exit status. CI uploads only the replay summary file.

## Optional live evaluation (uses API credits)

Reuse the configured local backend key. Neither CI nor normal tests runs this.
`LLM_PROVIDER=gemini` selects Gemini using `GEMINI_API_KEY`; the default is OpenAI
using `OPENAI_API_KEY`. Each result records its selected model. Transport tests
exercise Gemini tool calls, structured reports, usage, and HTTP failures with
mock responses; they do not establish live model accuracy or account access.
Start with one case:

```sh
npm run eval -- --live --case page-offset --max-usd 0.05
```

Only after checking that result, the full evaluation can be explicitly requested:

```sh
npm run eval -- --live --all --max-usd 1
```

Live mode uses the existing model, at most $0.02 estimated per case and a 60-second
per-case deadline. `--max-usd` is a persistent ledger ceiling (default $0.10,
maximum $1), not additional credit per invocation. The separate ledger is
`data/evals/live-budget.sqlite`; prior reservations consume this ceiling. Do not
delete it to circumvent the cap. Quota, authentication, model access, and budget
failures stop the suite early; unattempted cases remain in the denominator.
Reservations and estimates cannot guarantee the invoice amount. Automatic model
retries and remote tracing remain disabled. The source/question are sent to OpenAI;
expected answers and grading rubrics are not sent.

## Human accuracy review

For each live report, independently judge whether it identifies the specific causal
mechanism in the rubric, cites the relevant lines, proposes a correction addressing
that mechanism, and states material uncertainty. Merely repeating the issue or the
category name is insufficient. Mark failed runs incorrect. Record rationale for
every case and include the result file's exact run ID:

```json
{
  "runId": "copy-the-live-result-run-id",
  "reviewer": "reviewer name",
  "cases": [
    { "caseId": "n1-orders", "correct": true, "rationale": "Explains the per-customer query and proposes bounded batching." }
  ]
}
```

The example shows one entry; a review must contain all 20 case IDs exactly once.
Save it locally, then grade:

```sh
npm run eval:review -w @reposleuth/api -- ../../data/evals/RUN_ID.json ../../data/evals/review.json
```

The grader rejects replay results, mismatched run IDs, duplicate/missing judgments,
and correct grades for failed investigations. It writes `RUN_ID.json.reviewed.json`.
Passing requires >=95% completion, >=80% independently reviewed accuracy, valid
citations in every completed report, no forbidden tool calls, and p95 <90 seconds.
These are targets, not achieved AI-performance claims. Tool allowlist checks and
mocked HTTP GET assertions cover available write paths, not a universal security
proof. Curated snippets also do not establish performance on large real repositories.

## Recorded local verification

2026-10-23, scripted replay: 20/20 completed, all 20 reports passed citation checks,
zero forbidden tool calls, 194 ms total, p95 12 ms, $0 external API cost. Timings
vary by machine. All 20 mutated-citation cases were rejected by tests.
Real-model accuracy, live completion rate, real-repository latency, and billed
cost remain unmeasured because API credits were exhausted during the prior smoke
attempt. No live evaluation was run for Stage 5.
