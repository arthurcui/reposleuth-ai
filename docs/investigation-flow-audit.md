# Failed investigation flow audit

Status: audit complete; protocol redesign is not implemented or validated. Keep the merged v14 baseline. Do not treat the experimental v15 changes as a demonstrated reliability improvement.

## Evidence and limits

This audit uses the frozen live attempts for TanStack/query #7513 at commit `b0c09aa63d7b8dad84d34ee5ba49d280032e467d`, saved in `data/reliability-v15-verification-2026-10-29/`. Run `node data/reliability-v15-verification-2026-10-29/audit.mjs` to reproduce the numeric event timeline. It reads saved data only and records the attempts file hash.

Actual limits were Standard: $0.05 per run, 100,000 tokens, 12 requests, 24 tools, 2,000 output tokens and 120 seconds. These are not the remaining campaign allowance. Provider usage is measured; planning estimates are conservative forecasts. A gap between them is not permission to remove safety checks. Tool outcomes and arguments were recorded, but complete discovery payloads were not, so the audit cannot establish why the model repeated a successful search.

## GPT candidate: useful navigation stopped by the application

| Request | Model action / application decision | Estimated input | Reported input |
| --- | --- | ---: | ---: |
| 1 | Find the Solid package | 8,779 | 4,153 |
| 2 | Read createQuery implementation, 100–114 | 9,544 | 4,734 |
| 3 | Find createBaseQuery | 9,325 | 4,552 |
| 4 | Read createBaseQuery, delivered 104–181 | 9,434 | 4,630 |
| 5 | App disables tools and forces reporting | 9,408 for actual tool-free request | 4,925 |

Before request 5, actual estimated spend was $0.01475325, leaving $0.03524675. Planning another exploration call plus a future report reserved $0.035067, leaving only 119 bytes of tool-output allowance. The 1 KiB minimum triggered `COST_RESERVE`. The app ended exploration before the model could choose another source read. The resource code at line 233 and later reactive update logic were still unread.

This was not repeated-search failure, a provider rejection, a timeout, or exhaustion of actual spend. It was the application's conservative two-call forecast. That forecast includes full request input estimates, two maximum outputs, framing padding and a future tool result allowance. Hard admission remains necessary; the observed low spend does not prove an arbitrary next call would fit safely.

The candidate also increased context/instruction overhead and delivered fewer lines than v14 (104–195). The new focus option was never used. A test that scripts its use cannot establish that a live model will select it before the application stops exploration.

## Gemini candidate: repeated discovery, then a large planning reserve

| Request | Action | Estimated input | Reported input |
| --- | --- | ---: | ---: |
| 1 | Find solid-query | 26,408 | 5,156 |
| 2 | Find createBaseQuery in packages/solid-query | 28,906 | 5,865 |
| 3 | Repeat the same search | 26,834 | 5,277 |
| 4 | Repeat the same search again | 27,119 | 5,370 |
| 5 | Find solid-query under packages | 27,404 | 5,463 |
| 6 | Read createBaseQuery 1–150; delivered 1–119 | 29,761 | 6,144 |
| 7 | App forces reporting | 28,770 for tool-free request | 6,201 |
| 8 | Correct missing finding evidence IDs | 34,150 | 7,120 |

The first five discovery actions returned `ok`, not output-limit errors. Before reporting, the run had consumed 33,445 tokens including output, leaving 66,555. The next-exploration-plus-report forecast required 69,647 tokens before allowing more source, so it triggered `TOKEN_RESERVE`.

The estimator uses a UTF-8 byte count plus 4,096 for models without its supported tokenizer mapping. In this trace that bound was roughly five times measured input. The same conservative envelope is used for hard admission and exploration planning; planning adds another prospective report and maximum outputs. This is a concrete constraint on useful work, but one trace does not establish a safe universal replacement ratio.

Working context retains only four recent tool results and omits older large discovery payloads. It has no durable compact catalog of discovered file candidates. Together with repeated search choices, that is a plausible contributor; the saved data does not prove that omission caused these repeats. A future protocol should make discovery progress explicit rather than rely solely on prompt instructions to avoid repetition.

## Correction improved format, not evidence

The first Gemini report omitted evidence IDs on a finding. One correction supplied an existing handle and passed strict quotation validation. Its SSR-reactivity hypothesis still relied on issue discussion and the imports/prefix of createBaseQuery, rather than the causal implementation. Source validity and claim support are separate. This run is not a successful diagnosis merely because the corrected report was accepted.

## Next coherent implementation

Replace the single large exploration/reporting contract with an explicit two-phase protocol:

1. Exploration carries concise investigation instructions, repository tools, a compact discovery catalog and source evidence. It does not need the complete final report schema on every call. An explicit finish action transitions to reporting.
2. Reporting is tool-free and receives the report schema, relevant evidence, known gaps and narrowly scoped reporting instructions. The budget planner estimates this actual reporting envelope. Every physical request still passes the same hard limits and durable reservation checks.
3. Discovery retains deduplicated paths, query/scope identity and returned/truncated status. Repeating a pinned-revision query should preserve its known result and make lack of progress visible. It must not erase alternatives or silently choose a root cause for the model.
4. Reports distinguish observed source facts, supported hypotheses and unresolved issue explanations. No syntactic rule can universally prove semantic support. Import-only causal claims remain a failed acceptance outcome even when citations are valid.

This design is a hypothesis to test, not a promised result. Do not special-case TanStack paths, inject reviewer-only line targets into model context, weaken citation checks, calibrate a universal token multiplier from this sample, or raise the spending limit to manufacture a pass.

## Acceptance before promotion

- Offline: replay saved action sequences through the proposed request envelopes; account separately for tools, instructions, evidence and report schema. Demonstrate that useful continuation is admissible under unchanged limits, or document exactly why it still is not. Scripted actions test feasibility only.
- Offline: test actual SDK/provider transitions, cancellation, correction, incomplete usage, cumulative costs and failed admission; ensure exploration cannot bypass the required validated final report.
- Live, only within authorized funds: compare fixed engine versions on identical inputs and limits, with failed runs retained. Require deeper relevant source coverage and a supported explanation or precisely bounded abstention. Completion alone does not pass.
- Generalization: include another repository and an insufficient-evidence case before claiming broad reliability. This single issue cannot establish it.

No paid calls or engine edits were made during this audit. The previous live verification spent $0.0780212; remaining campaign allowance after conservative reservations is $0.43105785. The budget ledger and frozen attempts are unchanged by the audit.

## Offline feasibility exploration

`data/reliability-v15-verification-2026-10-29/envelope-experiment.ts` captures a real SDK request using an in-memory fake model, with network fetch disabled. Its initial estimates exactly match the saved candidate traces: 8,779 for GPT and 26,408 for Gemini. It then reconstructs a later context from the issue and delivered citations. Unknown discovery journal payloads are excluded, so the later context is a controlled approximation, not an exact replay of the live stop.

The experiment retains the existing estimators, safety margins, two maximum outputs, reporting padding and recorded remaining run allowances. It compares the same reconstructed source context under three request designs. The compact design includes an explicit finish tool in its exploration schema footprint.

| Source-output allowance at recorded remaining usage | Existing protocol | Remove report schema only | Compact exploration and reporting phases |
| --- | ---: | ---: | ---: |
| GPT-5.4 mini | 471 bytes | 945 bytes | 2,615 bytes |
| Gemini 3.5 Flash Lite | 0 bytes | 864 bytes | 7,500 bytes |

The current protocol requires at least 1,024 bytes to continue. Removing the report schema alone fails that threshold for both models in this approximation. Separating phase instructions as well leaves room for a bounded read. Passing saved source through the existing source-window function fits lines 233–275 for GPT and 233–290 for Gemini within those proposed allowances. These line targets were selected by the reviewer for offline feasibility, never supplied to a live investigator. The experiment does not show that a model would select them, that a further multi-file trace fits, or that a diagnosis would improve.

The request split is therefore a better-supported implementation hypothesis than another prompt addition. It is not validated production behavior. A real transition must change the SDK output contract, Gemini JSON-mode handling, validation timing and reporting reservation together. Exploration text must never accidentally become an accepted report; the final report must retain the complete schema and strict materialization checks.

The experiment also confirms a discovered path disappears after four later results when it has no source read or pinned plan. However, the first immediate duplicate Gemini search cannot be explained by that four-result eviction: the latest tool result is retained. Durable discovery memory would help later continuity, but it is not a demonstrated cure for the observed repetition. Query identity and a repeated-result signal should be tested separately without silently choosing the model's next investigation target.

No production engine changes, paid calls, estimator calibration or budget increases were made during this exploration. The initial-request equality check guards against silently comparing these results after the protocol changes. The JSON output records the limits of reconstruction alongside the measurements.

## Subsequent source-supplied control C

Following user authorization, one request per model received eight identical pinned source windows: full createQuery/createBaseQuery and QueryObserver 1–200. External Solid runtime and the reproduction were explicitly unavailable. This diagnostic used privileged retrieval, no tools, no retries or correction, unchanged $0.05 run limits and a 2,000-token output cap. It is not a production A/B comparison.

GPT returned MODEL_REQUEST_FAILED without usable usage; that is not evidence about its reasoning ability. Gemini completed with valid source citations and a supported fact about wrapper/resource integration. However, its causal explanation still relied on external SSR semantics not established by the input. Its counter-evidence confused boolean validation with a claim about dynamic evaluation; its proposed alternatives were mitigations rather than competing causes. The static option-update/refetch path was supplied but not connected into a complete explanation. Review therefore classifies it as partial, not a supported root-cause pass.

The result strengthens the need to address explicit claim support alongside retrieval. It does not establish that either model is incapable, or that the guided workflow will work. Detailed protocol, review and original results are in `data/reliability-v15-verification-2026-10-29/retrieval-control/`. No production changes were made for C.

Known estimated cost: $0.0080614 for Gemini. GPT's $0.02498175 uncertain reservation remains retained. Total incremental conservative reservations: $0.04795175. Current campaign reservations: $4.6168939 of $5; remaining allowance: $0.3831061. No additional calls were launched after C.

## Guided implementation checkpoint

The phase-split hypothesis is now implemented behind an explicit evaluation option, with shared budget admission and application-owned discovery state. It is not enabled in the normal UI. See [guided workflow](guided-workflow.md) for the command, contract tests, actual implementation feasibility replay and remaining acceptance requirements. The replay admits an additional source window, but still does not establish autonomous retrieval or diagnosis quality. Earlier sections describe the evidence available before implementation; they are retained as experiment history.
