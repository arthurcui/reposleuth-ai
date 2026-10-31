# Project handoff — 2026-10-30

## Stopping point

RepoSleuth AI is a working public-repository onboarding application with a retained experimental investigator. The final consolidation includes all pending source, tests and documentation. No further live evaluations, feature work or model requests are scheduled by this handoff.

Start with `npm install` and `npm run dev` at the repository root, then open http://localhost:5173/. Existing server configuration belongs in ignored `.env.local`; do not copy secrets into client variables or Git. The production container starts in demo mode. See the main README and deployment documentation for enabling live access and persisting data.

Onboarding discovers a pinned source inventory, samples a bounded source route and optionally requests one AI overview. Saved briefings can be searched, reopened and exported. Inputs are restored without automatically submitting a new request. History is collapsible and paginated. The investigation workspace remains under **Investigating (experimental)**. Guided and fixed-retrieval evaluation engines require explicit opt-in and do not replace the default application workflow.

## What was verified

The final consolidated source passed `npm run check`: formatting, TypeScript, ESLint, all **419 tests across 48 files**, and API/web production builds. Both `npm run eval` and `npm run eval -- --guided` completed **20/20 scripted cases**, with valid citations and zero forbidden tool calls. These offline replays establish pipeline behavior, not model reasoning accuracy. The final PR also runs Linux checks and a Docker deployment smoke test in GitHub Actions.

No paid requests were made during final consolidation. The previously authorized single Gemini verification for `arthurcui/web-image-audit` used 9,985 input and 400 output tokens at an estimated **$0.0039955**, producing a three-section overview with no walkthrough. Its saved briefing ID is `a37b0b28-cb27-40fe-9c67-1c936b6a12fa` at commit `c52e0d21af66f1f7fcc109def21917d1eaf964e4`. Actual model billing may differ from estimates.

## Limitations to retain

- AI overview prose can be wrong. The successful verification omitted `run` from `npm run browser:install`. Use **Declared setup** and repository documentation for exact commands; the saved model response has not been silently corrected.
- Walkthrough source identity, line bounds and static connectivity are validated; whether a citation supports a claim is not automatically established. An earlier .NET result cited the wrong in-range endpoint line. Sampling is bounded to six files and can miss important behavior.
- An invalid optional walkthrough no longer discards a valid overview. Invalid overviews preserve deterministic source details and show safe structural diagnostics. Historical rejected model output was not retained and cannot be recovered or reinterpreted.
- Reliable autonomous defect diagnosis was not demonstrated. Budget controls, tests and citation validation are engineering safeguards, not evidence of diagnostic correctness. See the retrospective and live-review documents for failures as well as successes.
- This is not a multi-user hosted service: add authentication, per-user isolation and operational hardening before shared public deployment.

## Preserve when moving machines

Keep `.env.local` private and back up the ignored `data` directory separately. It contains briefing/investigation SQLite databases, budget records, live evaluation artifacts and local working snapshots; none are published with source. Stop the application before copying SQLite databases, or use SQLite's backup facility. Do not delete budget records to bypass spending controls.

The repository contains implementation and reproducible offline tests. Private benchmark answers and existing local artifacts remain separate. No additional live run is necessary to stop here.
