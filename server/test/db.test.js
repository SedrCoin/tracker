import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { openDb } from "../db.js";

function tmpDbPath() {
  return join(tmpdir(), `tracker-test-${randomUUID()}.sqlite`);
}

test("пустая база отдаёт null-состояние", () => {
  const p = tmpDbPath();
  const db = openDb(p);
  assert.deepEqual(db.getState(), { state: null, updatedAt: 0 });
  db.close();
  rmSync(p, { force: true });
});

test("setState/getState роундтрип и upsert", () => {
  const p = tmpDbPath();
  const db = openDb(p);
  db.setState({ a: 1 }, 1000);
  assert.deepEqual(db.getState(), { state: { a: 1 }, updatedAt: 1000 });
  db.setState({ a: 2 }, 2000);
  assert.deepEqual(db.getState(), { state: { a: 2 }, updatedAt: 2000 });
  db.close();
  rmSync(p, { force: true });
});

test("состояние переживает переоткрытие базы", () => {
  const p = tmpDbPath();
  const db1 = openDb(p);
  db1.setState({ k: "v" }, 5);
  db1.close();
  const db2 = openDb(p);
  assert.deepEqual(db2.getState(), { state: { k: "v" }, updatedAt: 5 });
  db2.close();
  rmSync(p, { force: true });
});
