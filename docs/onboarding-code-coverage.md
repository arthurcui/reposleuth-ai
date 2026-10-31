# Source-backed onboarding coverage

The onboarding overview can now include a sampled source walkthrough with line-linked explanations and reading tips. It is an AI interpretation of static excerpts, not an executed trace or a verified runtime call graph.

## Retrieval and validation

- Choose one declared source entry, or a conventional main/server/index/App/Program filename.
- Follow each branch before waiting siblings, promoting already queued dependencies. Follow unambiguous TypeScript/JavaScript relative imports and explicitly labeled C# type-name candidates within the discovered scope. Skip conventional test files.
- Read at most six files, 120 lines and 2,400 whole-line characters per file, inside the existing 24-read allowance. Preserve missing, ambiguous and truncated coverage.
- Give those excerpts to the existing single summary request. The $0.03 estimated request cap and application budget remain unchanged; there are no extra model requests or retries.
- Accept walkthrough citations only within retrieved line ranges, across at least two files reachable from the sampled entry. This validates citation provenance and static connectivity, not explanation correctness.
- Preserve source details when an overview is absent or rejected. Old saved briefings remain readable without fabricated code evidence. New briefings are required to collect source coverage.

## Read-only GitHub smoke, October 30, 2026

| Repository | Pinned commit | Source files read |
| --- | --- | --- |
| arthurcui/reposleuth-bench-node-api | ce93b1c8fd7955a8e5b2637a182775fa4908f877 | 5: server, store, tickets, dashboard, credits |
| arthurcui/reposleuth-bench-dotnet | ecc63c120e05c73ad01549bef763fc050327fc7c | 5: Program, BookingService, Availability, Pricing, Booking |
| arthurcui/reposleuth-bench-react | fbd5222d4a9944377f74ef47ade9bc13be2e0990 | 6: main, Counter, Customer, TaskList, Cart, Tasks |

All three completed without model calls. These checks establish source coverage only; the subsequent live explanation review is recorded in [the three-case scorecard](onboarding-live-review-2026-10-30.md). Automated tests cover traversal, ambiguity, cycles, limits, exact citation ranges, disconnected-route rejection, export and safe rendering.

## Known boundaries

C# matching is lexical and can include comments/strings; it does not resolve namespaces, injection, overloads or dispatch. Relative imports establish dependencies, not execution order. Aliases, dynamic imports, external dependencies and other languages are not followed. One entry and short leading excerpts can miss the application's important path; coverage gaps are explicit. A syntactically valid citation can still accompany a wrong explanation, so the feature must not be described as a verified code-flow analysis.

## Depth-first follow-up

After the first live review, traversal was changed to prioritize descendants over siblings without increasing the six-file allowance. Read-only GitHub checks at the same three pinned commits succeeded. React now includes `src/api.ts` immediately after `src/Customer.tsx`; .NET reads `Domain/Booking.cs` after `Services/BookingService.cs`. Node retains the same five source files. The earlier coverage artifacts and live outputs remain unchanged.

The generation contract now requests one request or user-interaction example with an explicit trigger and result, permits a useful partial explanation, and treats React composition/state transitions as valid examples. Newly generated walkthroughs missing a trigger or result are rejected; old saved reports remain compatible. This is a structural check, not proof that the prose is correct. Exact citation and connectivity checks are unchanged.

The offline follow-up made no paid attempts. A subsequently authorized [second live comparison](onboarding-live-review-v2-2026-10-30.md) did not pass review: Node and React summaries were rejected, and the accepted .NET explanation cited the wrong endpoint line. The walkthrough PR remains on hold.

## Numbered sources and failure diagnostics

Model input now supplies each source line as `{line, text}`, using the excerpt's actual starting line. It does not ask the model to count newlines. Citation bounds and static connectivity checks are unchanged; explicit numbering does not establish semantic correctness.

Overview validation and optional walkthrough validation are independent. A valid overview survives an invalid optional walkthrough. The rejected walkthrough is removed and clearly labeled unavailable in the UI and Markdown export; no source range is silently repaired. Invalid overviews remain rejected. Previously saved briefings remain compatible.

Failures record the validation stage, code, up to eight structural issue paths/codes, response character count and SHA-256 fingerprint. Diagnostics do not retain raw rejected prose or raw provider error messages. JSON/response failures are distinguished from overview schema/source failures and walkthrough schema/citation/connectivity failures. Responses above 32,000 characters are rejected before parsing. These bounds keep diagnostics inspectable without presenting rejected content as accepted output.

This change has been verified offline only. It does not retroactively diagnose discarded responses from the two earlier live batches, and no additional model requests were made.
