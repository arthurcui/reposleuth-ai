# Guided investigation experiment

Status: implemented as an explicit evaluation option. One live matched pair reached deeper source but failed during reporting. Not enabled in the normal application and not ready for promotion.

## Run without model charges

```sh
npm run eval -- --guided
```

Without `--live`, this runs the existing 20 scripted cases through the service, storage, SDK loop and report validator. Results include `workflow: guided`. It is a contract/pipeline check, not a diagnosis benchmark. Adding `--live` invokes paid models and requires a separately authorized evaluation plan; no guided live runs have been launched during implementation.

Programmatic callers may explicitly pass `workflow: 'guided'` to `investigate`, or the optional final workflow argument to `InvestigationService`. Ordinary callers retain their existing workflow. The experimental phase events remain saved in service activity records; this change does not add a new UI selector.

## Behavior

1. Exploration uses concise investigation instructions, repository tools and no final-report schema. It can call `finish_investigation`, end with text, or be stopped by the reporting reserve. Any exploration prose is discarded rather than accepted as a report or promoted into trusted evidence.
2. An application-owned dossier retains the task/issue, immutable read handles, selected exact source, unread intervals and bounded discovery records. Query/scope identity, paths, truncation and repeat counts survive recent-journal rotation. Model-authored plans remain optional, explicitly unverified notes. Discovery memory is capped at eight records and 6,000 serialized bytes, with omission counts.
3. A separate tool-free reporting request receives that dossier, focused reporting instructions and the full report schema. The planner and actual reporter use the same request constructor. Reporting does not inherit a fresh request, time, token or cost allowance: both phases share the same budget-enforcing model, deadline and persistent reservation callback.
4. The backend validates report shape and materializes exact citations as before. Guided reports do not get the v15 automatic correction attempt. Invalid reports remain failures. Diagnosis is labeled unverified; runtime is not executed. Missing evidence may produce a partial report or no findings.

Gemini's compatibility adapter distinguishes exploration completion from final JSON-schema instructions. The final schema is supplied only for reporting; response-format handling and local validation remain explicit. This is a sequential workflow within one investigation, not autonomous agent delegation.

## Checks and limits

New SDK integration tests cover explicit finish, discarding exploration prose, final-request reserve, shared persistent budget, cancellation, forged evidence handles, reporter tool-call rejection, malformed reports without retry, and the actual Gemini adapter via mocked HTTP. Discovery tests cover repeated queries, scope identity, bounded metadata, omission and rejection of non-path results.

All 20 guided scripted replay cases completed with valid citations and zero forbidden calls. These are scripted answers with synthetic usage, not model-quality evidence. Replay ID: `8823079f-d933-4f1a-890b-dd595b03abcf`.

Final local checks: 365 tests across 40 files pass with one worker, as do formatting, type checking, lint and API/web builds. An existing HTTP/SSE lifecycle test timed out in the earlier two-worker full run; it passed in isolation and in the subsequent full one-worker run. Its timeout was not increased. This records test stability honestly rather than treating the first run as green.

An offline feasibility check used the same scripted source actions for the existing local workflow and guided workflow, the saved TanStack source and simulated usage from earlier measurements. The existing workflow stopped after createBaseQuery 104–180. Guided delivered 104–218 and admitted a further read at 233–248 before stopping for reporting reserve. Both stayed under unchanged Standard limits in this simulation.

That is a limited implementation result: the target was selected by the replay, the discovery payload was reconstructed, and the guided read still did not reach the later option-update logic. It establishes neither autonomous tool choice nor a supported diagnosis. Script and results are saved in `data/reliability-v15-verification-2026-10-29/guided-feasibility.*`.

## Remaining acceptance work

- Measure live decisions under frozen, matched inputs and limits before promotion. The source-supplied control already showed that available source alone does not guarantee claim support.
- Check multiple repositories and insufficient-evidence controls. Do not specialize production behavior to reviewer-selected paths or lines.
- Evaluate whether repeated-query visibility actually reduces repetition; this has not been demonstrated live.
- The one-tool-per-turn policy and bounded literal search remain. Batching independent calls would require budgeting their combined output; it is not silently enabled here.
- The schema, citation validator and coverage metadata cannot prove semantic causality. Reporting instructions strengthen the distinction but cannot guarantee compliance.

No paid calls, budget increases, commits or pushes were made for this implementation. The previous campaign allowance remains $0.3831061 after conservative reservations, including the unresolved GPT retrieval-control request.

## Subsequent live checkpoint

The separately authorized one-pair GPT-5.4 mini comparison used identical pinned inputs and Standard limits. The merged baseline completed a partial report after reading createBaseQuery 104–194. Guided autonomously selected a focused read of 225–283, reaching createResource, plus 104–181. Its final reporting request failed with MODEL_REQUEST_FAILED; no accepted report exists. Neither reached the later option-update logic at 355–365. This demonstrates a retrieval improvement in one attempt, not improved diagnosis quality or consistency.

Known estimated cost for the pair is $0.039405, with $0.01599375 unresolved for the failed request. Campaign conservative reservations total $4.78592965 of the approved $5, leaving $0.21407035. No retries or paid grading were performed. Frozen inputs, engines and attempts are under `data/guided-comparison-2026-10-29/`.

The original error classification discarded the underlying failure, so its cause cannot be reconstructed. Subsequent local changes save a `model_request_failed` activity event with allowlisted error type, transport code and numeric HTTP status. They never save error messages, bodies, headers or arbitrary provider codes. Phase events locate guided failures in exploration or reporting. Existing error codes, hard limits, retained reservations and no-retry behavior remain unchanged. These diagnostics do not fix or explain the historical failure and have not been live-validated.
