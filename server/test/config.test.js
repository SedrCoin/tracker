import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../config.js";

test("loadConfig требует TRACKER_TOKEN", () => {
  assert.throws(() => loadConfig({}), /TRACKER_TOKEN/);
});

test("loadConfig подставляет дефолты", () => {
  const c = loadConfig({ TRACKER_TOKEN: "x" });
  assert.equal(c.token, "x");
  assert.equal(c.port, 8787);
  assert.equal(c.dbPath, "./data/tracker.json");
  assert.equal(c.allowOrigin, "https://sedrcoin.github.io");
  assert.equal(c.maxBody, 2_000_000);
});

test("loadConfig читает переопределения", () => {
  const c = loadConfig({
    TRACKER_TOKEN: "x",
    PORT: "9000",
    DB_PATH: "/tmp/a.db",
    ALLOW_ORIGIN: "https://e.x",
    MAX_BODY: "100",
  });
  assert.equal(c.port, 9000);
  assert.equal(c.dbPath, "/tmp/a.db");
  assert.equal(c.allowOrigin, "https://e.x");
  assert.equal(c.maxBody, 100);
});
