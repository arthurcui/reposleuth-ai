# Live onboarding walkthrough review — second batch, October 30, 2026

## Decision

Hold the walkthrough PR. None of the three new attempts meets the reviewed acceptance criteria. Better static source coverage did not establish reliable explanation generation.

This was one Gemini `gemini-3.5-flash-lite` call per repository, with a fresh $0.09 total ceiling and no retries or paid grading. The reviewing assistant compared accepted output against the retrieved source. No application code was executed. The prior batch and artifacts remain unchanged.

## Spending

Three requests used 7,236 input tokens and 1,517 output tokens. Estimated cost: **$0.0059633** at configured rates, not a provider invoice. Conservative reservation: **$0.0264390**. Reservations are not additional billed usage. All three approved attempts are consumed; no automatic follow-up calls will use the remaining allowance.

## Results

| Case | Previous batch | Second batch | Reviewed outcome |
| --- | --- | --- | --- |
| Node API | Broad but incomplete walkthrough | Rejected with `UNSUPPORTED_CODE_ROUTE` | No accepted explanation to assess |
| .NET | Missing endpoint-to-service connection | More concrete example, accepted structurally | Wrong line cited for the selected endpoint |
| React | Model declined a walkthrough | Rejected with `INVALID_OR_UNAVAILABLE_SUMMARY` | No accepted explanation to assess |

### Node

Source retrieval still includes server, store, tickets, dashboard and credits at commit `ce93b1c8fd7955a8e5b2637a182775fa4908f877`. All five source files are reachable in the recorded static-reference graph. The route validator requires at least two distinct cited files as well as reachability. Given that graph and the validation order, the failure indicates fewer than two distinct cited files; this is an inference from the validator, not a review of the discarded response. Raw rejected model text was not preserved, so its narrative quality cannot be assessed.

### .NET

The model chose a concrete GET `/bookings` example and explained the `BookingService.Between` date filtering. It cited `Program.cs:10–10` for the endpoint mapping, but that line maps GET `/search` to `Search`. The `/bookings` mapping is line 9. The service citation at `Services/BookingService.cs:1–4` supports the filtering description.

The cited range is inside a retrieved file, so bounds/connectivity validation passed. This demonstrates that source provenance validation is not semantic citation validation. The report is therefore not a correctness pass, even though it was accepted by the backend.

[Actual endpoint lines](https://github.com/arthurcui/reposleuth-bench-dotnet/blob/ecc63c120e05c73ad01549bef763fc050327fc7c/Program.cs#L9-L10)

### React

Depth-first retrieval now includes `src/api.ts` after `src/Customer.tsx`, at the same pinned commit `fbd5222d4a9944377f74ef47ade9bc13be2e0990`. The previously missing data helper was available to the model. The summary was rejected with a generic validation/unavailability error. Token usage was reported, but the saved result does not preserve the raw response or detailed parse/schema error. We cannot responsibly identify the exact malformed field or claim a model-provider outage from this evidence.

## Next engineering step

Before another paid run, improve offline observability and citation ergonomics:

1. Preserve bounded rejected-response diagnostics separately from accepted reports, with parse/schema issues and the exact validation stage. This must not expose credentials or display rejected prose as a validated briefing.
2. Give models explicitly numbered source lines or source handles instead of asking them to count lines in a plain string. The current prompt sends start/end metadata but unnumbered code text.
3. Preserve supported overview sections if an optional walkthrough alone fails validation, while clearly labeling the missing/rejected walkthrough. Do not weaken the walkthrough's citation checks or quietly repair a wrong citation.

These are proposed follow-ups, not implemented or proven by this batch. The useful merged onboarding baseline remains separate from this uncommitted experimental walkthrough.

## Artifacts

Raw accepted reports, source excerpts, Markdown exports and the ledger are saved under `data/onboarding-live-review-v2/`. Rejected raw responses were not retained by the current implementation. No source, validator, prompt or budget changes were made during this paid comparison.
