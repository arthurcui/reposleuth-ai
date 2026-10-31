/** Persists onboarding jobs and runs one bounded repository briefing at a time without model credentials. */
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { type Briefing, type BriefingRequest, briefingSchema } from '@reposleuth/shared';

import { parseRepository, validatePath } from '../github/repositoryIndex.js';
import { RepositoryError, type RepositoryProvider } from '../github/RepositoryProvider.js';
import { buildBriefing } from './buildBriefing.js';

export class BriefingService {
  private db: DatabaseSync;
  private pending?: Promise<void>;
  constructor(
    path: string,
    private readonly connect: (repository: string) => Promise<RepositoryProvider>,
    private readonly explain?: (report: Briefing, request: BriefingRequest) => Promise<Briefing>,
  ) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('CREATE TABLE IF NOT EXISTS briefings (id TEXT PRIMARY KEY, body TEXT NOT NULL)');
    for (const row of this.db
      .prepare("SELECT body FROM briefings WHERE json_extract(body, '$.status') = 'running'")
      .all()) {
      const report = briefingSchema.parse(JSON.parse(String(row.body)));
      this.save({
        ...report,
        status: 'failed',
        error: 'Server restarted before this briefing completed. Generate a new briefing to retry.',
      });
    }
  }
  private save(report: Briefing) {
    this.db
      .prepare(
        'INSERT INTO briefings VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET body=excluded.body',
      )
      .run(report.id, JSON.stringify(report));
  }
  get(id: string): Briefing | undefined {
    const row = this.db.prepare('SELECT body FROM briefings WHERE id=?').get(id);
    return row ? briefingSchema.parse(JSON.parse(String(row.body))) : undefined;
  }
  list(query = '') {
    return this.db
      .prepare(
        "SELECT body FROM briefings WHERE instr(lower(json_extract(body,'$.repository') || ' ' || json_extract(body,'$.scope')), lower(?)) > 0 ORDER BY json_extract(body,'$.createdAt') DESC LIMIT 50",
      )
      .all(query)
      .map((row) => briefingSchema.parse(JSON.parse(String(row.body))));
  }
  start(request: BriefingRequest): Briefing {
    if (this.pending) throw new RepositoryError('BUSY', 'A briefing is already running.');
    const { owner, repo } = parseRepository(request.repository);
    const scope = request.scope.replace(/\/$/, '');
    validatePath(scope, true);
    const report: Briefing = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      repository: `${owner}/${repo}`,
      commitSha: '',
      scope,
      status: 'running',
      durationMs: 0,
      filesDiscovered: 0,
      filesRead: 0,
      languages: [],
      directories: [],
      packages: [],
      documents: [],
      manifests: [],
      readingOrder: [],
      testFiles: [],
      limitations: [],
      requestedModel: request.selection,
      includeOverview: request.explain,
    };
    this.save(report);
    this.pending = this.run(report, request).finally(() => {
      this.pending = undefined;
    });
    return report;
  }
  private async run(report: Briefing, request: BriefingRequest) {
    const started = Date.now();
    const check = () => {
      if (Date.now() - started >= 120000)
        throw new RepositoryError('TIMEOUT', 'Briefing time limit reached.');
    };
    try {
      const repository = await this.connect(report.repository);
      let completed = await buildBriefing(repository, report, check);
      if (request.explain) {
        this.save(completed);
        completed = this.explain
          ? await this.explain(completed, request)
          : {
              ...completed,
              summaryError:
                'AI overview is unavailable. Configure a model on the server; source details are still available.',
            };
      }
      this.save({ ...completed, status: 'completed', durationMs: Date.now() - started });
    } catch (error) {
      const code = error instanceof RepositoryError ? error.code : 'REPOSITORY_UNAVAILABLE';
      this.save({
        ...report,
        status: 'failed',
        error: `Briefing stopped: ${code}. Check the public repository URL, scope, and GitHub access.`,
        durationMs: Date.now() - started,
      });
    }
  }
  async close() {
    await this.pending;
    this.db.close();
  }
  async drain() {
    await this.pending;
  }
}
