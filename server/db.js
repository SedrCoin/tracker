import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function openDb(path) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE IF NOT EXISTS state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );`);

  const selectStmt = db.prepare("SELECT json, updated_at AS updatedAt FROM state WHERE id = 1");
  const upsertStmt = db.prepare(
    `INSERT INTO state (id, json, updated_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`
  );

  return {
    getState() {
      const row = selectStmt.get();
      return row
        ? { state: JSON.parse(row.json), updatedAt: row.updatedAt }
        : { state: null, updatedAt: 0 };
    },
    setState(stateObj, updatedAt) {
      upsertStmt.run(JSON.stringify(stateObj), updatedAt);
      return updatedAt;
    },
    close() {
      db.close();
    },
  };
}
