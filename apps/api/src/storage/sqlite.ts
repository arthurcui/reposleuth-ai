/** Persists investigations, events, and usage reservations in SQLite. */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Investigation, InvestigationEvent } from '@reposleuth/shared';
import { StopError } from '../agents/budget.js';

export class InvestigationStore {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS investigations (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, investigation_id TEXT NOT NULL, at TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_run ON events(investigation_id, id);
      CREATE TABLE IF NOT EXISTS budget (id INTEGER PRIMARY KEY CHECK(id=1), reserved REAL NOT NULL);
      INSERT OR IGNORE INTO budget VALUES (1, 0);`);
  }
  save(value: Investigation) {
    this.db
      .prepare(
        'INSERT INTO investigations VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET body=excluded.body',
      )
      .run(value.id, JSON.stringify(value));
  }
  get(id: string): Investigation | undefined {
    const row = this.db.prepare('SELECT body FROM investigations WHERE id=?').get(id);
    return row ? (JSON.parse(String(row.body)) as Investigation) : undefined;
  }
  active(): Investigation[] {
    return this.db
      .prepare(
        "SELECT body FROM investigations WHERE json_extract(body,'$.status') IN ('queued','running')",
      )
      .all()
      .map((row) => JSON.parse(String(row.body)) as Investigation);
  }
  append(id: string, type: string, data: Record<string, unknown>): InvestigationEvent {
    const at = new Date().toISOString();
    const result = this.db
      .prepare('INSERT INTO events(investigation_id,at,type,data) VALUES (?,?,?,?)')
      .run(id, at, type, JSON.stringify(data));
    return { id: Number(result.lastInsertRowid), investigationId: id, at, type, data };
  }
  events(id: string, after = 0): InvestigationEvent[] {
    return this.db
      .prepare('SELECT * FROM events WHERE investigation_id=? AND id>? ORDER BY id LIMIT 1000')
      .all(id, after)
      .map((row) => ({
        id: Number(row.id),
        investigationId: String(row.investigation_id),
        at: String(row.at),
        type: String(row.type),
        data: JSON.parse(String(row.data)),
      }));
  }
  reserve(amount: number, ceiling: number) {
    // Atomic across processes. Reservations intentionally never refunded: conservative lifetime cap.
    const result = this.db
      .prepare('UPDATE budget SET reserved=reserved+? WHERE id=1 AND reserved+?<=?')
      .run(amount, amount, ceiling);
    if (!result.changes) throw new StopError('BUDGET_EXCEEDED');
  }
  reserved() {
    return Number(this.db.prepare('SELECT reserved FROM budget WHERE id=1').get()!.reserved);
  }
  close() {
    this.db.close();
  }
}
