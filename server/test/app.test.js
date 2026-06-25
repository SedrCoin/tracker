import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { openDb } from "../db.js";
import { createApp } from "../app.js";

const TOKEN = "test-token";
const ORIGIN = "https://sedrcoin.github.io";

async function withServer(run) {
  const db = openDb(":memory:");
  const app = createApp({ db, token: TOKEN, allowOrigin: ORIGIN, maxBody: 1000 });
  const server = createServer(app);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base);
  } finally {
    server.close();
    db.close();
  }
}

const authH = { Authorization: `Bearer ${TOKEN}` };

test("GET /health без токена → 200 ok", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(res.headers.get("access-control-allow-origin"), ORIGIN);
  });
});

test("OPTIONS preflight → 204 с CORS", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/state`, { method: "OPTIONS" });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("access-control-allow-origin"), ORIGIN);
    assert.match(res.headers.get("access-control-allow-methods"), /PUT/);
  });
});

test("неизвестный путь → 404", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/nope`);
    assert.equal(res.status, 404);
  });
});

test("GET /state без токена → 401", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/state`);
    assert.equal(res.status, 401);
  });
});

test("GET /state с неверным токеном → 401", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/state`, { headers: { Authorization: "Bearer nope" } });
    assert.equal(res.status, 401);
  });
});

test("пустое состояние → null", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/state`, { headers: authH });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { state: null, updatedAt: 0 });
  });
});

test("PUT затем GET — роундтрип", async () => {
  await withServer(async (base) => {
    const put = await fetch(`${base}/state`, {
      method: "PUT",
      headers: { ...authH, "Content-Type": "application/json" },
      body: JSON.stringify({ state: { hi: 1 }, updatedAt: 1234 }),
    });
    assert.equal(put.status, 200);
    const { updatedAt } = await put.json();
    assert.ok(updatedAt >= 1234);
    const get = await (await fetch(`${base}/state`, { headers: authH })).json();
    assert.deepEqual(get.state, { hi: 1 });
    assert.equal(get.updatedAt, updatedAt);
  });
});

test("PUT с битым JSON → 400", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/state`, {
      method: "PUT",
      headers: { ...authH, "Content-Type": "application/json" },
      body: "{не json",
    });
    assert.equal(res.status, 400);
  });
});

test("PUT слишком большого тела → 413", async () => {
  await withServer(async (base) => {
    const big = JSON.stringify({ state: { blob: "x".repeat(5000) }, updatedAt: 1 });
    const res = await fetch(`${base}/state`, {
      method: "PUT",
      headers: { ...authH, "Content-Type": "application/json" },
      body: big,
    });
    assert.equal(res.status, 413);
  });
});
