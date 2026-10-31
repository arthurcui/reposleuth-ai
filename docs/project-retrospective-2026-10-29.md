# RepoSleuth AI: scope, work completed, results and remaining problems

**Review date:** October 29, 2026, America/Vancouver  
**Purpose:** Give the project owner a candid account of what was built, what was tried, what succeeded, what failed, and whether further work is justified.  
**Evidence:** Repository history, implementation documents, saved benchmark/pilot reports, frozen investigation traces and the recent offline audit. This is a retrospective, not a new live evaluation. Historical status notes are interpreted at their recorded checkpoint; some older documents still describe API-credit blocks that were subsequently resolved.

## 1. Overall assessment

RepoSleuth is a functioning read-only investigation application with a real model-driven agent. It is more than a prewritten demo: live models choose tools, retrieve GitHub code and generate reports. The UI demo is separately labeled and synthetic.

The product foundation is substantially implemented. There are real successes on small, deliberately defective applications and some useful static analysis on public issues. However, **reliable diagnosis of unfamiliar, larger repositories has not been demonstrated**. The recent candidate did not improve the difficult public-repository case we tested.

The central gap is between **a report that can be generated and whose quotations are valid** and **a report whose evidence actually establishes a useful explanation**. We improved the first much more consistently than the second.

My recommendation is to retain the merged version as the baseline, keep the unmerged candidate experimental, and concentrate further work on the investigation flow rather than adding product features. The proposed exploration/reporting split has promising offline feasibility evidence, but is not yet implemented or proven with live models.

## 2. Original scope and what the project became

The original MVP was an agent that accepts a public GitHub repository and issue, independently investigates source, and produces an actionable report with paths, lines, hypotheses, confidence and uncertainty. It was to run on the user's machine initially, with no repository modification or arbitrary shell execution.

| Area | Current scope/status | What this does not establish |
| --- | --- | --- |
| Public GitHub access | Repository validation, issue/comments, revision pinning, bounded discovery/search, source, history and diffs | Complete coverage of every repository or language |
| Agent execution | Real iterative model/tool loop, external OpenAI and Gemini adapters | Correct autonomous diagnosis on every run |
| Reports | Structured findings, evidence, recommendations, test plans, risks, uncertainties and reasoning summary | Executed fixes or verified runtime causes |
| User interface | Start/cancel runs, activity, metrics, evidence navigation, report recovery | Investigation quality from appearance or completion status |
| History | SQLite storage, full-text search, repository/issue/model/status filters, reopen and Markdown export | Multi-user authorization or shared cloud isolation |
| Models and depth | Model discovery/selection; Quick, Standard and Deep limits | Equal behavior across models or validated superiority of Deep |
| Deployment | Local development, Docker and deployment checks | Readiness to expose a shared authenticated cloud service |
| Engineering quality | Separate source/tests/evaluation, stricter lint and type checks, formatting, smaller components, CI | Model reasoning accuracy |
| Evaluation | 20 illustrative/replay cases; 15 seeded live benchmark issues; public-issue pilots and paired comparisons | A representative production accuracy estimate |

The investigator still does not modify repositories, execute their code, run proposed fixes or create PRs. Development PRs for RepoSleuth itself are separate from the product's capabilities. A vector database and multi-agent investigation system were not added. Searchable history uses SQLite full-text search, not embeddings.

Cloud deployment is possible as hosting, but the application remains a single-user server. Authentication, ownership, per-user limits and storage isolation would be prerequisites for shared access.

Sources: [README](../README.md), [implementation history](../IMPLEMENTATION_PLAN.md), [architecture](architecture.md), [history boundaries](investigation-history.md), [code structure](code-structure.md).

## 3. What was built successfully

### Application and operating controls

The foundation progressed through repository integration, the agent/API, investigation UI, deployment and evaluation. Subsequent work added Gemini, model discovery, history/search/export, depth modes and code organization. Git history records these as merged work through PR #14.

Operational problems were addressed along the way: confusing empty/non-JSON API errors, missing-issue preflight, GitHub access/rate-limit diagnostics, provider quota/access errors, saved-run form restoration, demo/live transitions and model selection recovery. These are meaningful usability and operating improvements, but separate from diagnosis accuracy.

The application has durable events and results, reconnect/recovery behavior, cancellation, request/tool/token/time/cost limits and persistent conservative reservations. Keys remain server-side. The repository tool surface is read-only, and source is pinned to a commit for stable citations.

### Source fidelity and navigation

Evidence handles let the backend construct exact quotes and commit references from source actually returned in the run. This reduced dependence on the model transcribing source correctly. Invalid handles, unsupported line ranges and inconsistent references remain rejected.

Navigation evolved from bounded listing/literal search to scoped filename discovery, syntax-based TS/JS outlines and definition reads. C# navigation remains a labeled lexical fallback, not full semantic analysis. Definition resolution was improved for overloads, getters and scope collisions. Large reads now deliver a bounded usable window with continuation rather than necessarily withholding the whole result.

These changes solved specific mechanical problems. They did not guarantee that the model would follow the needed continuation or select the relevant implementation before exploration stopped.

### Evaluation infrastructure

Three separate public projects contain five seeded defects each: Node/TypeScript, C#/.NET and React/TypeScript. The saved initial verification documents reproductions of all 15 intended symptoms. Private expected answers are separated from investigator inputs.

Benchmark runs preserve issues, commits, settings, results and failures. Automated grading is available, with judgments labeled separately from deterministic validation. Later comparisons froze both engines and retained failed attempts rather than rerunning until success.

This infrastructure made it possible to discover that nominal completion was misleading. That is a useful result even when the measured product outcome was disappointing.

Source: [public benchmarks](public-benchmarks.md).

## 4. What the live evaluations actually showed

The evaluations below are different experiments. Their scores should not be combined into one accuracy percentage. “AI pass” means an automated rubric judgment, not independent human review or executed verification of a proposed fix.

### Small seeded applications

| Experiment | Observed result | Interpretation |
| --- | --- | --- |
| First 15-case comparison, two models | Gemini: 11/15 accepted and AI-passing reports. GPT: 15/15 accepted, but 0/15 with source evidence and 0 AI passes | GPT was forced to report before reading source. Completion was not success. This measured an agent-policy bottleneck, not model incapability. |
| Revised reporting reserve, same 15 cases | Gemini: 12/15 accepted/AI passes. GPT: 15/15 accepted, only 1 with source, 0 AI passes | A limited change helped exploration somewhat but did not solve GPT's usable coverage. |
| Model-aware accounting/preflight smoke, three cases per model | All six completed; five AI passes and one uncertain result | Real positive signal, but a small combined-change test. GPT's .NET case still missed the service implementation. |
| Targeted navigation checks | Three selected cases received AI passes, including GPT reading BookingService.cs | The intended source path could be reached and used. Not proof of repeatability. |
| Three repeats of three cases per model | Gemini: 8/9 completed and AI passes. GPT: 7/9 completed, 6 AI passes | Node/React successes were repeatable in this small set. GPT's .NET case remained uncertain or invalid. |
| Response-selection follow-up | One new GPT .NET run read service and endpoint, completed and received an AI pass | Verified the fixed application path can work. It did not prove the earlier failures all had the same cause. |

These results show that the project can perform real, useful investigations on some bounded tasks. They also show why a successful one-off run was insufficient evidence to declare the engine reliable.

Sources: [initial comparison](../data/benchmarks/comparison-2026-10-27/report.md), [reserve revision](../data/benchmarks/comparison-reserve-v4-2026-10-27/report.md), [token smoke](../data/benchmarks/smoke-token-v5-2026-10-27/report.md), [navigation checks](../data/benchmarks/navigation-v6-2026-10-27/report.md), [repeats](../data/benchmarks/consistency-v6-2026-10-27/report.md), [response selection](../data/benchmarks/report-selection-2026-10-28/report.md).

### Public repositories: a harder test

Three pinned issues tested different situations: an Express IPv6 case, a TanStack/Solid SSR cross-file case, and an ambiguous Express issue without a stable reproduction. Public issue comments included explanations; these were informed investigations, not blind bug discovery.

The first six-run pilot produced **one useful report, three partial reports and two failures** under the recorded review. A judge initially rated the TanStack report useful; review of the actual reads downgraded it because the causal implementation had not been inspected. That exposed a limitation in automated grading too.

Several targeted follow-ups improved individual steps:

| Approach | What worked | What remained unresolved |
| --- | --- | --- |
| Package-scoped discovery | Models could locate relevant package paths | GPT still had invalid reads; Gemini repeated discovery |
| Range error feedback and recovery | GPT corrected an oversized request and read the wrapper | It stopped before the base implementation; Gemini produced invalid JSON |
| Preflight reuse and budget diagnostics | The app could expose the exact stopping constraint | A small lifetime allowance confounded that particular run; no source was read |
| Filename search across bounded tree metadata | Both models reached relevant paths; Gemini recovered to a smaller read | Reports remained partial or failed evidence validation |
| More precise citation diagnostics | Failures became easier to classify | A later report passed exact citation checks while citing imports for an unsupported causal claim |
| Claim-grounding instructions | Two controlled synthetic generations distinguished imports from behavioral code | No baseline control or repeated evidence; this did not carry over reliably to the harder repository |

Sources: [pilot](../data/pilots/public-issues-2026-10-28/run-01/report.md), [scoped search](../data/pilots/public-issues-2026-10-28/run-02-scoped/report.md), [read recovery](../data/pilots/public-issues-2026-10-28/run-03-recovery/report.md), [preflight](../data/pilots/public-issues-2026-10-28/run-04-preflight/report.md), [tree discovery](../data/pilots/public-issues-2026-10-28/run-05-discovery/report.md), [citation failure](../data/pilots/public-issues-2026-10-28/run-06-evidence/report.md), [controlled grounding](../data/pilots/public-issues-2026-10-28/run-07-grounding/report.md).

### Broader paired reliability work

| Round | Baseline | Candidate | What can be concluded |
| --- | --- | --- | --- |
| First paired public-issue round: 12 attempts per engine | 8 completed; 1 AI-supported diagnosis | 8 completed; 2 AI-supported diagnoses | No broad improvement established; supported results concerned the same Express issue. |
| v14 follow-up: 12 attempts per engine | 7 completed; 0 AI-supported diagnoses; target implementation reached twice | 10 completed; 3 AI-supported diagnoses; target implementation reached four times | Limited completion/retrieval improvement. TanStack cause remained unestablished; many judgments were uncertain. |
| v15 acceptance check: GPT and Gemini, one attempt per engine on TanStack | Both completed; neither established the causal path | Both completed; neither established the causal path; less source read | Failed the intended improvement goal. Too small to prove a universal regression, but no basis to promote v15 as reliable. |

Sources: [first paired report](../data/reliability-comparison-2026-10-28/report.md), [v14 report](../data/reliability-v14-2026-10-29/report.md), [v15 acceptance report](../data/reliability-v15-verification-2026-10-29/report.md).

## 5. The unmerged v15 work: implemented, but not successful enough

The candidate adds one budget-checked, tool-free correction for malformed report structure; persistent unread-range tracking; focused reads around a call inside a large definition; and UI diagnostics distinguishing corrected reports from failures. Corrections still pass strict evidence validation.

The last full local verification passed **353 tests across 38 files, 20 scripted replay cases, formatting, type checks, lint and both builds**. These checks establish implementation behavior. They do not establish autonomous diagnosis quality.

The live acceptance check was more revealing:

- GPT baseline read createBaseQuery lines 104–195; candidate read 104–181. Both also read the wrapper. Neither reached the resource logic beginning at 233.
- Gemini baseline read 1–239; candidate read only 1–119 and used more requests.
- Gemini's candidate corrected a report with missing finding evidence IDs. The accepted hypothesis still cited a file prefix/imports rather than the causal implementation.
- Neither candidate used the new focused-read option.

**Decision:** preserve this work and its failed check, but do not merge it as a demonstrated diagnosis/reliability improvement. A narrower operational feature could eventually be evaluated separately; it must not be marketed as solving the larger problem.

## 6. What the audit established about the bottleneck

### The application can stop useful exploration before actual spend is exhausted

In GPT's candidate run, the first four calls made useful progress. Actual estimated spend before forced reporting was approximately **$0.0148 of $0.05**. The planner forecast another exploration request plus a final report at roughly $0.0351, leaving only 119 bytes for tool output. Because the minimum useful allowance is 1 KiB, RepoSleuth disabled tools.

This is a conservative planning decision, not a provider error or proof that GPT chose to stop. It does not justify removing hard admission checks: lower actual usage in one run cannot guarantee the next request's cost.

### Repeated discovery and conservative input bounds compound the problem

Gemini made five discovery actions before reading source. Three searches used the same query and scope. All were recorded as successful tool executions, but full discovery payloads were not retained, so the precise reason for repetition is unknown.

At the stopping point, 66,555 tokens remained in the run allowance, while the next-exploration-plus-report forecast required 69,647 before additional source. The fallback estimator uses UTF-8 bytes plus padding and was roughly five times reported input usage in this trace. It is deliberately conservative, but materially constrains useful exploration.

Working context can lose discovered paths after four later results unless they are preserved elsewhere. However, eviction cannot explain the first immediate repeated search because the latest result is retained. Discovery memory is a real limitation, not a complete causal explanation for the observed behavior.

### Valid citations do not prove the attached claim

Backend checks establish that a quote came from the pinned source read. They do not establish that an import block proves SSR behavior, that a wrapper proves a callee defect, or that a proposed fix resolves the issue. The recent correction recovered structure without solving this semantic gap.

Source: [detailed flow audit](investigation-flow-audit.md).

## 7. Current exploration: promising feasibility, not another claimed fix

An offline experiment captured initial SDK request estimates that exactly matched the saved live traces. It then reconstructed later source context and compared request designs under the same estimators, margins and recorded remaining allowances.

| Available source-result space in reconstructed state | Current design | Remove report schema only | Compact exploration/reporting phases |
| --- | ---: | ---: | ---: |
| GPT | 471 bytes | 945 bytes | 2,615 bytes |
| Gemini | 0 bytes | 864 bytes | 7,500 bytes |

Only the full phase separation exceeded the 1,024-byte continuation threshold for both. Existing source-window code could fit a relevant saved excerpt within those allowances. The experiment included a finish-tool schema in the exploration footprint.

Important limits: the later state excludes unknown discovery payloads; the source target was reviewer-selected; no live model chose it; no new diagnosis was generated; and the actual SDK/provider phase transition is not implemented. This supports a design hypothesis, not a production quality claim.

The proposed design is to use a concise exploration contract and durable discovery state, then switch explicitly to a tool-free reporting contract with the full report schema. All physical calls would still face the same hard limits. It must be tested as one coherent change rather than a series of prompt additions.

## 8. Spending and what the numbers mean

There are separate approved campaigns and ledgers. Conservative reservations are not invoices: they may retain unused upper bounds and uncertain-request allowance. Estimated cost uses reported tokens and configured rates; account billing/free-tier treatment can differ. Codex/chat subscription usage is not included.

| Documented campaign group | Reported estimated model cost, approximately | Scope |
| --- | ---: | --- |
| Original seeded comparisons plus token/navigation follow-ups | $0.6362 | Original $5 campaign; cumulative figure from its final report |
| Seeded consistency round plus response-selection check | $0.2899 | Separate $2 campaign |
| Initial public pilot and follow-ups 01–04 | $0.1757 | Separate $1 campaign |
| Public follow-ups 05–07 | $0.0478 | Separate $0.30 campaign |
| Recent paired comparisons and v15 verification | $0.9713 | Current $5 campaign |

These documented groups subtotal approximately **$2.12 in estimated API usage**, including grading where their reports include it. This is not a complete lifetime billing total: earlier ad hoc calls and unrelated user runs are not reconciled here. The groups must not be confused with their much larger authorization or reservation amounts.

For the **current** campaign specifically: conservative reservations are **$4.56894215 of $5**, leaving **$0.43105785**. The latest four-run verification cost an estimated **$0.0780212**, while adding **$0.3383531** in conservative reservations. No paid calls were made for the subsequent audit, offline exploration or this report. Remaining allowance from separate historical campaigns is not automatically pooled.

## 9. Where my approach fell short

1. **I gave local test progress too much prominence.** Tests showed the code obeyed its contracts, but the user's goal was a useful autonomous investigation. I should have led with that distinction earlier and more consistently.
2. **I made too many successive narrow changes.** Range handling, discovery, prompts, reserves and correction each addressed a symptom. The end-to-end interaction between them needed examination sooner.
3. **Some follow-ups had weak experimental control.** One attempt, changed lifetime ceilings or several simultaneous changes could show feasibility but not isolate improvement. Those limitations are recorded, but the work still spent effort without establishing a clear product gain.
4. **Automated grading was not sufficiently decisive.** Some judgments were uncertain; one public pilot needed a downgrade after reading the actual coverage. A model's favorable judgment was never equivalent to a tested fix.
5. **The documentation accumulated stale checkpoint statements.** Early credit-blocked statuses and “no live calls yet” notes coexist with later live results. This report distinguishes their historical scope; it does not imply every older page has been rewritten.

There was also useful discipline: preserving failed attempts, maintaining hard limits, retaining strict citation validation, freezing comparison inputs and declining to call v15 a success after it failed live acceptance. That gives us evidence to change direction rather than hide the failure.

## 10. Current code state and recommended decision

- **Merged baseline:** PR #14, commit `1bbe6768a710ac6b1b4e2e442cf205f9d9359833`.
- **Working branch:** `codex/report-reliability-coverage`.
- **Uncommitted work:** v15 correction/coverage/navigation/UI changes and supporting tests/docs. It has not been pushed in this phase.
- **Proposed redesign:** documented and measured offline; not implemented.
- **Detailed evaluation artifacts:** in ignored `data/` directories. Git does not back them up; retain a separate backup if they need to survive machine loss.

**Recommended next milestone:** demonstrate that the agent reaches the relevant implementation and returns a supported explanation or a precise, useful abstention under unchanged limits. Implement and evaluate the phase split, progress memory and evidence-support behavior together. Keep the current failed case, another repository and an insufficient-information case in acceptance checks; do not optimize only for a known line number.

Do not add RAG/vector storage, autonomous fixes, more providers or cloud-sharing features to solve this immediate problem. None has been shown to address the bottleneck found in these traces. Do not assume a more expensive model or higher budget is required until the request-flow issue is tested.

The project is worth continuing if the intended next step is a bounded engineering experiment with a clear stop/go decision. It is not ready to promise dependable general-purpose defect diagnosis. If the next coherent change still fails the live acceptance goal, reconsider the product's scope—such as a guided investigator where an engineer selects an initial code area—before continuing an open-ended sequence of small adjustments.
