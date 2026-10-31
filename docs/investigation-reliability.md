# Investigation reliability milestone

## Confirmed baseline

The pinned public-issue pilot exposed repeated discovery, reads that stop before the relevant implementation, and unsupported causal claims with exact citations. Input estimates were conservative, but one sample cannot justify lowering margins. The latest controlled grounding check behaved correctly on two synthetic excerpts; it did not establish real-repository reliability. Existing local claim-grounding changes are preserved.

## Integrated design and acceptance gates

1. Navigation: bounded outlines and definition reads for TypeScript/JavaScript; explicitly labeled lexical fallback for C#. Follow local imports/callees using returned locations, never pretend text search resolves a call graph. Navigation metadata is not evidence. Successful source reads alone create handles.
2. Working context: retain the original task/issue, an explicit model-authored investigation plan, a compact tool-result journal and immutable source evidence. Remove redundant old discovery payloads, never silently rewrite a citation. Every actual compacted request passes the same budget admission checks.
3. Coverage: track retrieved files/ranges and unresolved paths. The model records hypotheses, their supporting handles and next missing evidence. Plans remain unverified model notes. Budget exhaustion produces a partial report with coverage gaps.
4. Reporting: expose source-fidelity validation separately from semantic and runtime verification. No model or heuristic may mark a diagnosis verified merely because it generated citations. Legacy reports remain readable with unknown verification state.
5. Evaluation: frozen inputs, model settings, prompt version, source commit, repeats and explicit caps. Cover known defects plus correct behavior, missing information, misleading/import-only evidence and multi-file causes. Offline fixtures test plumbing/constraints, not model intelligence.

## Local gate

- Multi-file scripted SDK investigation follows wrapper to implementation and preserves both evidence handles through context compaction.
- Navigation tests include late definitions, overloaded names, unsupported languages, malformed source, excluded paths, limits and no execution.
- Context tests prove bounded journal size, exact evidence retention, no promotion of untrusted content and no bypass of admission limits.
- Reporting/UI/export distinguish generated, source-validated, semantically unverified and runtime-unverified.
- Existing budget, cancellation, history and source-validation suites remain green.

## Paid campaign gate (not authorized by this milestone)

The local implementation includes four adversarial fixtures (missing implementation, correct batching, a multi-file defect, and a misleading function name). Their expectations stay outside the investigator. `npm run eval:compare -- <observations.json>` compares paired baseline/candidate assessments offline and rejects duplicate attempts or mismatched input/settings hashes. Its `readyForComparison` field only indicates assessed, aligned inputs without candidate hard-limit violations; it does not certify the required case coverage, repeats, or improved quality.

Before any campaign, agree one total cap and freeze both baseline and candidate. Run the existing 15 cases and adversarial/abstention cases with identical provider settings and limits, at least three repeats per selected model. Keep failed and incomplete runs. Measure supported diagnosis, appropriate abstention, relevant implementation reached, cost and duration separately. Use automated judgments with recorded rationales and deterministic checks where feasible; do not call those ground truth. Require no new false diagnosis on correct/insufficient cases and no budget regression; any broader quality claim requires reviewed comparative results, not completion count.

## Scope boundaries

One read-only agent, no code execution, vector database or multi-agent orchestration. Preserve hard limits and uncertain reservations. No paid calls, commit or push without separate user authorization. Offline completion is implementation readiness, not proof this milestone has achieved reliable live diagnosis.

## Local validation status

Formatting, type checking, lint, API/web builds, and the 20-case scripted replay pass. The test suite covers navigation, compact-context SDK integration, report verification labels, and paired comparison validation. A regression test ensures the newest source read is delivered intact even if it exceeds the 18 KB retained-evidence target; normal request admission still applies. Older source text can be omitted from model context, but its handle remains in the catalog and the original source remains available for backend citation validation.

No live-model calls were made for this milestone. TypeScript/JavaScript navigation is syntax-based rather than a semantic reference graph; C# remains a labeled lexical fallback. Provider behavior with compacted context and any change in diagnosis quality, completion rate, or cost remain to be measured by the paid campaign.

## Subsequent authorized live comparison

After local validation, the user authorized a fresh $5 total comparison cap. Frozen baseline commit `31db802` and the local candidate were tested on three pinned public issues with GPT-5.4 mini and Gemini 3.5 Flash Lite, twice each: 24 model-backed investigations, plus 16 automated report assessments. An earlier 12-attempt batch failed network access before any model calls and remains recorded separately.

Each engine completed 8/12 attempts. The candidate had two AI-supported diagnoses versus one for the baseline, all on the same Express issue; neither reached the targeted TanStack implementation. Most semantic assessments remained uncertain. This small selected sample does not establish an overall reliability improvement. Estimated API cost including grading was $0.438099; conservative reservations were $2.121682 of the $5 cap. No further calls were launched after this comparison.

Local artifacts are in `data/reliability-comparison-2026-10-28/`: frozen sources/bundles and hashes, attempts and events, judge inputs/outputs, the shared budget ledger, cost reconciliation script, and `report.md`. These ignored artifacts contain the detailed diagnosis of remaining failures: repeated oversized reads, overload signatures mistaken for implementations, missing JavaScript getter navigation, and report/citation contract failures. Address those together before broadening paid evaluation; preserve strict validation and this baseline.

## Source-contract follow-up (local validation only)

Protocol `bounded-source-contract-v14` addresses the demonstrated navigation and read-contract failures as one change. Both read tools return an exact prefix within the 200-line, 4,000-character quote and dynamic byte limits, with explicit continuation. Bounded provider output-limit recovery happens inside the tool; other provider failures are not retried. Evidence registration is serialized across concurrent reads. Definition reads prefer bodies over same-scope overload declarations, and outlines include named JavaScript function expressions, getters/setters and static function properties. Duplicate implementations remain ambiguous.

Report citations can select a whole delivered window with a handle and null bounds, avoiding manual line-range transcription. Explicit subranges remain supported. Unknown handles, partial bounds, unseen source, overlong quotes, dangling references and malformed JSON still fail validation. This is not a general malformed-report repair mechanism, and it does not resolve the automated judge's uncertainty or prove semantic correctness.

Validation: 335 tests and 20 scripted replay cases pass, along with formatting, type checks, lint and API/web builds. Two HTTP tests initially hit their five-second timeout in a parallel run; both passed independently and the full suite passed with two workers. Offline checks of saved pilot source identify the actual `createQuery` body at lines 100–114 and Express's `subdomains` getter at lines 383–394. These checks establish tool behavior, not live-model improvement. No further paid calls, commits or pushes were made; the prior comparison and budget ledger remain unchanged.

A subsequent verification found and fixed a same-line lexical-scope collision: declaration-to-body matching now uses source offsets rather than scope line numbers. The regression ensures a declaration cannot redirect into a sibling namespace beginning on the same line. The fresh full suite passes 336 tests; saved pilot source checks still identify the intended bodies.

## Matched v14 follow-up

The user approved another comparison within the existing remaining allowance. Frozen baseline `31db802` and protocol `bounded-source-contract-v14` ran the same three pinned issues with the same GPT-5.4 mini/Gemini models and Standard limits, twice each with reversed engine order. No retries were substituted for failed attempts. The candidate API/shared source hash was `fcbe7ebe0a2c0671f070910fe0fc48f67eff3b3e8fa33bd470f665b68cf329a6`.

| Outcome | Baseline (12 attempts) | Candidate (12 attempts) |
| --- | ---: | ---: |
| Completed reports | 7 | 10 |
| AI-supported diagnosis attempts | 0 | 3 |
| AI-supported appropriate abstentions | 1 | 0 |
| Target implementation ranges retrieved | 2 | 4 |
| Unreviewed/uncertain or failed attempts | 11 | 9 |
| Estimated investigation cost | $0.202447 | $0.218965 |

The candidate's three supported diagnoses all concern Express #7532: one GPT and two Gemini attempts. GPT twice followed the actual `createQuery` body into `createBaseQuery`, but still stopped before the targeted resource logic. Neither engine established the TanStack root cause. Candidate Gemini no longer failed on oversized citation ranges in this sample; its two failures were findings without evidence references, rejected by the unchanged schema. Automated assessments remain uncertain for many reports and are not ground truth. These are limited retrieval/completion gains on selected cases, not broad reliability or model-superiority claims.

This follow-up cost an estimated $0.455208 including 17 report assessments. Across both rounds, estimated API cost is $0.893307, conservative reservations are $4.230589 of the approved $5, and unallocated conservative allowance is $0.769411. No budget violations were observed. The shared ledger remains in the original campaign directory; new frozen engines, events, judgments and reconciled results are in `data/reliability-v14-2026-10-29/`. No additional paid runs were launched after this follow-up.

## Report correction and source coverage (v15, offline validation)

Following the PR #14 merge, `report-correction-coverage-v15` addresses two observed failure modes: malformed final report structures and stopping at the beginning of a large implementation. JSON/schema failures permit one tool-free model correction, admitted through the same hard budget controls. There is no extra cost allowance or retry loop. The replacement must pass strict citation materialization; forged handles and invalid ranges still fail. Correction events are visible in activity, and the UI distinguishes an earlier rejected response from a subsequently accepted report.

Working context now preserves unread intervals after older discovery results are removed. A focused definition read can target a uniquely matched call deep inside an implementation, with the existing source-window and quote bounds. Remaining unexamined intervals mark the final report partial and are included in unanswered questions. This does not force the model to follow every path or establish a root cause.

Offline validation passes 353 tests across 38 files, 20 scripted replay cases, formatting, type checks, lint, and API/web builds. The SDK integration test reaches a call at line 232 and retains the unread prefix in final coverage. Tests also cover one-shot correction, budget rejection, invalid citations after correction, and UI diagnostics. Replay results are saved under run `d4ec8ad6-3a7a-4bc5-aa9c-021842dccf17` and measure implementation contracts, not reasoning accuracy.

No paid model calls were made for this milestone. The frozen comparisons and shared budget ledger remain unchanged. Live improvement in completion or diagnosis quality is unmeasured; a future matched comparison must account for the correction request as part of each attempt's existing limits.

### Subsequent live acceptance check: not ready to promote

After the user requested verification, four live attempts compared merged v14 and frozen v15 on the same pinned TanStack #7513 issue, once per engine with GPT-5.4 mini and Gemini 3.5 Flash Lite. Actual Standard limits matched ($0.05, 100,000 tokens); the harness's $0.18 ceiling did not override the stricter mode cap. No reruns or paid grading were used. Results are preserved in `data/reliability-v15-verification-2026-10-29/`.

All four completed, but none established the causal path. GPT's candidate read createBaseQuery 104–181 versus baseline 104–195. Gemini's candidate read only 1–119 versus baseline 1–239, which at least entered the resource logic. Neither candidate used focused definition reading. Gemini's candidate recovered a malformed report through one correction, but its accepted hypothesis cited imports rather than the relevant implementation. Citation fidelity did not establish semantic support. These observations are a Codex assessment of saved source and reports, not independent grading or executed reproduction.

Do not promote v15 as a demonstrated reliability improvement. This small sample does not prove a general regression, but it fails the intended acceptance goal. The next coherent change must address repeated discovery, context/reporting overhead and whether cited source supports findings, with the saved failure retained as an acceptance case. Local tests alone are insufficient.

This verification used $0.0780212 in estimated API cost and $0.3383531 in conservative reservations. The campaign ledger now reserves $4.56894215 of $5, leaving $0.43105785. No further paid attempts were launched.
