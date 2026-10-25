/** Migrates and queries the SQLite full-text index for this server's saved investigations. */
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';

import type { HistoryPage, HistoryQuery, Investigation } from '@reposleuth/shared';

const columns = (body: string, id: string) => `${id},
  json_extract(${body}, '$.request.question'),
  coalesce(json_extract(${body}, '$.report.summary'), ''),
  coalesce((SELECT group_concat(json_extract(value, '$.title') || ' ' || json_extract(value, '$.explanation'), ' ')
    FROM json_each(${body}, '$.report.findings')), ''),
  coalesce((SELECT group_concat(json_extract(value, '$.path'), ' ')
    FROM json_each(${body}, '$.report.evidence')), '')`;

export function initializeHistory(db: DatabaseSync) {
  // Creating the index, triggers, and legacy backfill is one atomic migration.
  db.exec('BEGIN IMMEDIATE');
  try {
    const exists = db
      .prepare("SELECT 1 FROM sqlite_master WHERE name='investigation_search'")
      .get();
    if (!exists) {
      db.exec(`CREATE VIRTUAL TABLE investigation_search USING fts5(id UNINDEXED, question, summary, findings, paths);
        INSERT INTO investigation_search SELECT ${columns('body', 'id')} FROM investigations;
        CREATE TRIGGER investigation_search_insert AFTER INSERT ON investigations BEGIN
          INSERT INTO investigation_search VALUES (${columns('new.body', 'new.id')});
        END;
        CREATE TRIGGER investigation_search_update AFTER UPDATE ON investigations BEGIN
          DELETE FROM investigation_search WHERE id=old.id;
          INSERT INTO investigation_search VALUES (${columns('new.body', 'new.id')});
        END;
        CREATE TRIGGER investigation_search_delete AFTER DELETE ON investigations BEGIN
          DELETE FROM investigation_search WHERE id=old.id;
        END;
        CREATE INDEX history_created ON investigations(json_extract(body, '$.createdAt') DESC, id DESC);
        CREATE INDEX history_repository ON investigations(lower(json_extract(body, '$.request.repository')));
        CREATE INDEX history_issue ON investigations(json_extract(body, '$.request.issueNumber'));
        CREATE INDEX history_model ON investigations(json_extract(body, '$.model'));
        CREATE INDEX history_status ON investigations(json_extract(body, '$.status'));`);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function listHistory(db: DatabaseSync, query: HistoryQuery): HistoryPage {
  // Options span all saved runs so filtering or pagination never hides a model.
  const models = db
    .prepare(
      "SELECT DISTINCT json_extract(body, '$.model') AS model FROM investigations ORDER BY model",
    )
    .all()
    .map((row) => String(row.model))
    .filter(Boolean);
  const conditions: string[] = [];
  const params: SQLInputValue[] = [];
  if (query.q) {
    // Treat input as literal words, never as FTS operators or SQL syntax.
    const words = query.q.match(/[\p{L}\p{N}_]+/gu) ?? [];
    if (!words.length)
      return { items: [], total: 0, limit: query.limit, offset: query.offset, models };
    conditions.push(
      'i.id IN (SELECT id FROM investigation_search WHERE investigation_search MATCH ?)',
    );
    params.push(words.map((word) => `"${word}"`).join(' AND '));
  }
  if (query.repository) {
    conditions.push("lower(json_extract(i.body, '$.request.repository')) = lower(?)");
    params.push(query.repository);
  }
  if (query.issueNumber !== undefined) {
    conditions.push("json_extract(i.body, '$.request.issueNumber') = ?");
    params.push(query.issueNumber);
  }
  if (query.model) {
    conditions.push("json_extract(i.body, '$.model') = ?");
    params.push(query.model);
  }
  if (query.status) {
    conditions.push("json_extract(i.body, '$.status') = ?");
    params.push(query.status);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  // One read transaction keeps the count and page consistent during writes from other processes.
  db.exec('BEGIN');
  try {
    const total = Number(
      db.prepare(`SELECT count(*) AS total FROM investigations i ${where}`).get(...params)!.total,
    );
    const rows = db
      .prepare(
        `SELECT i.body FROM investigations i ${where}
      ORDER BY json_extract(i.body, '$.createdAt') DESC, i.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, query.limit, query.offset);
    const items = rows.map((row) => {
      const run = JSON.parse(String(row.body)) as Investigation;
      return {
        id: run.id,
        request: run.request,
        status: run.status,
        createdAt: run.createdAt,
        model: run.model,
        summary: run.report?.summary ?? null,
        hasReport: run.report !== null,
      };
    });
    return { items, total, limit: query.limit, offset: query.offset, models };
  } finally {
    db.exec('COMMIT');
  }
}
