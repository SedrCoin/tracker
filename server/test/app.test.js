import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { openDb } from "../db.js";
import { createApp } from "../app.js";

const TOKEN = "test-token";
const ORIGIN = "https://sedrcoin.github.io";

async function withServer(run, opts = {}) {
  const db = openDb(":memory:");
  const app = createApp({ db, token: TOKEN, allowOrigin: ORIGIN, maxBody: 1000, fatsecret: opts.fatsecret });
  const server = createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
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

test("GET /trackerapi/health тоже работает, если прокси не срезал префикс", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/trackerapi/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
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

// --- FatSecret endpoints ---

const mockFatsecret = {
  searchFoods: async (q) => [{ id: "35755", name: "Bananas (" + q + ")", brand: "", desc: "" }],
  getFood: async (id) => ({ id, name: "Bananas", brand: "", per100g: { kcal: 89, p: 1.1, f: 0.3, c: 22.8 } }),
};

test("/foods/search без fatsecret → 503", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/foods/search?q=banana`, { headers: authH });
    assert.equal(res.status, 503);
  });
});

test("/foods/search без токена → 401", async () => {
  await withServer(
    async (base) => {
      const res = await fetch(`${base}/foods/search?q=banana`);
      assert.equal(res.status, 401);
    },
    { fatsecret: mockFatsecret }
  );
});

test("/foods/search с токеном → 200 и список", async () => {
  await withServer(
    async (base) => {
      const res = await fetch(`${base}/foods/search?q=banana`, { headers: authH });
      assert.equal(res.status, 200);
      const j = await res.json();
      assert.equal(j.foods[0].name, "Bananas (banana)");
    },
    { fatsecret: mockFatsecret }
  );
});

test("/trackerapi/foods/search с токеном → 200 и список", async () => {
  await withServer(
    async (base) => {
      const res = await fetch(`${base}/trackerapi/foods/search?q=banana`, { headers: authH });
      assert.equal(res.status, 200);
      const j = await res.json();
      assert.equal(j.foods[0].name, "Bananas (banana)");
    },
    { fatsecret: mockFatsecret }
  );
});

test("/foods/search пустой q → 400", async () => {
  await withServer(
    async (base) => {
      const res = await fetch(`${base}/foods/search?q=`, { headers: authH });
      assert.equal(res.status, 400);
    },
    { fatsecret: mockFatsecret }
  );
});

test("/foods/get с токеном → 200 и нутриенты", async () => {
  await withServer(
    async (base) => {
      const res = await fetch(`${base}/foods/get?id=35755`, { headers: authH });
      assert.equal(res.status, 200);
      const j = await res.json();
      assert.equal(j.food.per100g.kcal, 89);
    },
    { fatsecret: mockFatsecret }
  );
});
