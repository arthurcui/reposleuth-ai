# Fixed-retrieval reference experiment

This evaluation-only alternative asks whether autonomous exploration earns its complexity. It does not change the application workflow.

## Contract

`apps/api/evaluation/reference/` extracts at most four lexical terms from the question/issue, prioritizing identifiers. It performs bounded filename and source searches, falls back to one file listing, and reads at most six 80-line windows with 18 KB of exact source. No expected answers, reviewer paths or selected lines enter retrieval. It supplies those windows to one tool-free model request and uses the existing strict report and citation validators. Missing context remains explicit; reports are labeled partial and diagnoses unverified. No correction request, model-selected navigation, code execution or automatic changes are allowed.

The reference uses the existing provider adapter, model settings and hard budget accounting. A disabled SDK trace context is required around direct adapter calls; this does not enable telemetry. The guided comparator uses the same report instructions, provider, limits and source fixtures.

Offline retrieval command (choose a new output directory):

```powershell
node --import tsx apps/api/evaluation/reference/runner.ts --output=data/reference-offline-new
```

The four fixtures cover insufficient information, correct batching, a wrapper/service defect and misleading naming. Offline output tests retrieval and plumbing only. Private expected answers stay outside model input. The fixed search misses the wrapper in the multi-file fixture; no answer-specific rule was added to hide that limitation.

## First attempted live comparison: inconclusive

Eight attempts were made with GPT-5.4 mini: four reference and four guided, alternating order, with identical per-attempt conservative reservation ceilings of $0.025. No retries or paid grading occurred. The source and implementation snapshot is under `data/reference-frozen-2026-10-30/`; outputs are under `data/reference-live-2026-10-30/`.

| Workflow | Observed outcome | What it establishes |
| --- | --- | --- |
| Reference | Four MODEL_REQUEST_FAILED errors; no reports | Harness failure, not model diagnostic quality |
| Guided | Four completed insufficient-evidence reports; zero source reads | The reservation allowance forced reporting before exploration; not investigative success |

The trial was poorly configured and cannot select a winning architecture. In particular, comparing reference failures with guided completion percentages would be misleading. The simple fixtures also cannot establish performance on unfamiliar public repositories.

Subsequent offline testing reproduced `No existing trace found` in the actual OpenAI adapter before HTTP dispatch. The reference harness had called that adapter outside an SDK trace context. A disabled trace context fixes the completed-response test. This is a local harness defect; it does not explain the older guided reporting failure, whose original exception was discarded.

An offline admission probe now rejects live plans that cannot admit the guided workflow's initial exploration request. The original $0.025 plan is therefore refused before model access. This checks initial feasibility, not guaranteed completion or diagnosis quality. The four live pairs have not been rerun after either correction.

Known reported model cost was $0.0168225. Failed reference attempts retain $0.04689075 in unresolved reservations, despite the reproduced pre-HTTP defect; the persistent ledger has not been refunded or rewritten. Campaign conservative reservations rose by $0.093615 to $4.87954465 of the approved $5, leaving $0.12045535. Reservations are not invoices.

## Decision

Keep both experiments out of the production default. No architecture or diagnosis-quality conclusion is supported yet. A valid next comparison must first pass real-adapter offline tests and budget admission, then use frozen matched inputs and enough allowance for exploration plus reporting. Assess code-supported findings, counterexamples, missing evidence and fix plausibility separately from completion. Do not expand the product or claim reliability based on these results.

## Subsequent authorized public-issue trial

After correcting the adapter invocation and passing its offline regression test, one real reference investigation was run on the frozen TanStack/query #7513 issue and commit. It completed with five exact source citations, but failed semantic review: it attributed Svelte tests to Solid, inferred a call path from imports without reading the implementation, and overstated an SSR hypothesis in the summary. Only the queryOptions identity-helper finding was directly supported as a static fact; it did not explain the defect.

Retrieval selected configuration, type tests and two frameworks' files, exhausting its source allowance before reaching createBaseQuery. This is a negative result for this fixed-retrieval alternative, not evidence that the model or guided architecture can never work. The detailed review and unchanged original report are in `data/reference-final-2026-10-30/review.md` and `attempt.json`.

One request cost an estimated $0.01322175 (7,297 input and 1,722 output tokens), with complete usage. Conservative campaign reservations now total $4.89827365 of $5; $0.10172635 remains. No retry, paid grading, target code execution or promotion followed. Keep the reference workflow evaluation-only.
