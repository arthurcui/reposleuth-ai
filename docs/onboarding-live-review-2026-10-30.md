# Live onboarding walkthrough review — October 30, 2026

## Decision

Hold the code-walkthrough PR. The new source retrieval and citation checks work on these examples, but the explanations do not yet consistently deliver the promised representative path. This is a three-case exploratory review, not evidence of general accuracy.

The reviewing assistant compared each generated explanation with the exact source excerpts sent to the model. No human review, extra model grading request, code execution or retry was performed.

## Run conditions and spending

- Provider/model: Gemini, `gemini-3.5-flash-lite` (configured server default).
- One complete briefing per public benchmark repository, one model request per briefing.
- Approved campaign cap: $0.09; existing $0.03 per-request and application-budget controls retained.
- Provider-reported tokens: 6,857 input and 1,469 output across three requests.
- Estimated usage cost: **$0.0057296**. This is configured-rate accounting, not a provider invoice.
- Conservative application/campaign reservations: **$0.0256548**, intentionally not refunded by the existing budget implementation. Reservations are not additional billed usage.
- All three authorized attempts are consumed. There will be no automatic retries or use of the remaining allowance.
- Raw outputs, Markdown exports and the durable ledger are saved under `data/onboarding-live-review/` (ignored by Git).

## Scorecard

| Case | Purpose/setup | Citation provenance | Representative code path | Useful reading guidance | Verdict |
| --- | --- | --- | --- | --- | --- |
| Node API | Supported by README and manifest | Accepted; cited ranges match retrieved code | Partial: broad route dispatch, then store initialization; omits a specific handler between them | Helpful but generic | Partial |
| .NET backend | Supported by README | Accepted; cited ranges match retrieved code | Partial: service registration, then query methods; skips the endpoint-to-method link | Mostly useful, but null-handling wording needs care | Partial |
| React frontend | Supported by README, manifest and entry source | Overview paths accepted; no walkthrough to validate | Missing: model explicitly declined | No per-step reading tips | Fail for walkthrough acceptance |

## Findings against source

### Node: useful orientation, incomplete example

Pinned commit: `ce93b1c8fd7955a8e5b2637a182775fa4908f877`.

The model correctly identifies the training support-desk API, documented setup and in-memory Store. Its walkthrough cites `src/server.ts:6–25` and `src/store.ts:2–11`, which support the stated facts. However, it lists most HTTP routes and then describes data initialization. It does not follow one input through a handler to an output.

A supported route was already available in the retrieved source: `GET /tickets` parses page parameters in `src/server.ts:12–15`, calls `listTickets`, reads and slices stored tickets in `src/tickets.ts:2–4`, and serializes the result at `src/server.ts:26`. No additional source read was needed for that explanation. This is an explanation-selection weakness, not solely a retrieval problem.

[Server source](https://github.com/arthurcui/reposleuth-bench-node-api/blob/ce93b1c8fd7955a8e5b2637a182775fa4908f877/src/server.ts#L12-L26) · [Handler source](https://github.com/arthurcui/reposleuth-bench-node-api/blob/ce93b1c8fd7955a8e5b2637a182775fa4908f877/src/tickets.ts#L2-L4)

### .NET: accurate components, missing connecting step

Pinned commit: `ecc63c120e05c73ad01549bef763fc050327fc7c`.

The explanation correctly describes singleton registrations and BookingService query methods. Its first step cites `Program.cs:1–8`; the endpoint invoking `Between` is line 9, outside that step's citation. A clearer walkthrough would include `/bookings` to `Between` to `BookingStore.Rows`, explaining the returned collection without claiming verified runtime behavior.

The reading tip asks the reader to inspect how the methods handle null notes. That is ambiguous: `row.Note!` suppresses compiler nullability warnings; the shown code has no runtime null guard before `Contains`. The output does not explicitly claim safe null handling, but the phrasing risks giving that impression and should not count as a demonstrated correctness pass.

[Endpoint source](https://github.com/arthurcui/reposleuth-bench-dotnet/blob/ecc63c120e05c73ad01549bef763fc050327fc7c/Program.cs#L9-L10) · [Service source](https://github.com/arthurcui/reposleuth-bench-dotnet/blob/ecc63c120e05c73ad01549bef763fc050327fc7c/Services/BookingService.cs#L2-L6)

### React: honest abstention, but too restrictive

Pinned commit: `fbd5222d4a9944377f74ef47ade9bc13be2e0990`.

The model declined a walkthrough because it considered the components independent rather than a sequential execution flow. That avoids inventing a chain, but a useful onboarding route can explain component composition and a user interaction without claiming a linear execution trace.

The retrieved `src/main.tsx:8` renders Customer. `src/Customer.tsx:4–6` shows selection state, a change handler, an effect calling `customer(id)`, and the displayed name. These are enough for a bounded partial explanation. The imported `src/api.ts` was not retrieved: breadth-first traversal spent all six reads on the entry plus sibling components. It must remain an explicit unknown until read.

[Mount source](https://github.com/arthurcui/reposleuth-bench-react/blob/fbd5222d4a9944377f74ef47ade9bc13be2e0990/src/main.tsx#L8) · [Customer source](https://github.com/arthurcui/reposleuth-bench-react/blob/fbd5222d4a9944377f74ef47ade9bc13be2e0990/src/Customer.tsx#L2-L6)

## Recommended next change

Treat the output as a concrete example with a trigger, connected processing/components, and an observable result. Ask for one supported route rather than broad component descriptions; explicitly allow React composition/state interactions. Make missing links explicit and allow a useful partial explanation.

Change bounded source selection to reserve depth for one branch instead of exhausting the allowance on siblings. Preserve the six-file limit, one-request cost cap and strict citation validation. Verify these changes offline first; any further live attempts need a separately agreed run plan. Do not weaken validation to turn the missing React walkthrough into a nominal success.
