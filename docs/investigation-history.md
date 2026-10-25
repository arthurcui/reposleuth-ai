# Investigation history

History is stored in the existing SQLite database. `storage/history.ts` creates an
FTS5 index over the question, report summary, finding titles and explanations, and
evidence paths. The first startup migrates existing records in a transaction.
SQLite triggers maintain the index on inserts, updates, and deletions, including
saves performed by another connection. No vector store or embedding calls are used.

## Queries and exports

`GET /api/investigations` accepts the optional parameters `q`, `repository`,
`issueNumber`, `model`, `status`, `limit` (1–100, default 20), and `offset` (default
0, maximum 1,000,000). Unknown parameters and invalid values return 400. Repository
URLs are normalized to `owner/repo`; repository matching ignores case. Model,
issue, and status filters use exact matches.

Search extracts literal Unicode words and combines them with AND. Paths such as
`src/customers.ts` match their component words. FTS operators are not exposed to
users, and all query values are bound parameters. Blank search lists all matching
runs; punctuation-only search returns no matches. Results are sorted by creation
time descending, then ID descending. Count and page use one read transaction.
Offset pages can shift when new runs arrive; clicking Search again returns a current snapshot.

List responses contain metadata and summaries, not full reports or source quotes.
Reopening fetches the existing run. Markdown export is available only for records
with reports, through `GET /api/investigations/:id/export`. The export includes
usage and uncertainties, escapes report markup, and safely fences source excerpts.
No model or GitHub request is required for listing, reopening, or exporting.

The server opens storage independently of model credentials. Creating new runs
still requires a configured provider; the credential-free demo does not create
saved investigations.

## User scope before shared cloud deployment

The current product is a single-user server with local Host/Origin restrictions,
not a multi-user service. Every caller allowed to access that server can access
its saved history. Repository/model filters do not establish authorization.

Before adding shared cloud access:

1. Authenticate requests and derive an immutable owner ID on the server. Never
   accept a query parameter as proof of ownership.
2. Store ownership with each investigation; explicitly assign legacy records to
   an administrator-selected account rather than exposing them to all users.
3. Apply the owner constraint to search, counts, pagination, ID reads, exports,
   event streams, cancellation, and every source/report endpoint. Join FTS results
   only to authorized investigation rows.
4. Add cross-user denial tests for both known IDs and search terms, including
   counts and exports, before changing the current local-access restrictions.

Private benchmark answer keys remain in ignored local data and are not indexed.
