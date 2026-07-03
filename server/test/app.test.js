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

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

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

test("POST /auth/register создаёт пользователя с отдельным state", async () => {
  await withServer(async (base) => {
    const reg = await fetch(`${base}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: { name: "Миша", height: 180 }, state: { mine: true } }),
    });
    assert.equal(reg.status, 200);
    const created = await reg.json();
    assert.ok(created.userId);
    assert.ok(created.token.startsWith("trk_"));
    assert.equal(created.profile.name, "Миша");

    const userH = { Authorization: `Bearer ${created.token}` };
    const get = await (await fetch(`${base}/state`, { headers: userH })).json();
    assert.deepEqual(get.state, { mine: true });

    await fetch(`${base}/state`, {
      method: "PUT",
      headers: { ...userH, "Content-Type": "application/json" },
      body: JSON.stringify({ state: { mine: false, user: "Миша" }, updatedAt: 1 }),
    });
    const userState = await (await fetch(`${base}/state`, { headers: userH })).json();
    assert.equal(userState.state.user, "Миша");

    const legacyState = await (await fetch(`${base}/state`, { headers: authH })).json();
    assert.equal(legacyState.state, null);
  });
});

test("GET /auth/me отдаёт профиль пользователя", async () => {
  await withServer(async (base) => {
    const reg = await fetch(`${base}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: { name: "Аня" }, state: {} }),
    });
    const created = await reg.json();
    const me = await fetch(`${base}/auth/me`, { headers: { Authorization: `Bearer ${created.token}` } });
    assert.equal(me.status, 200);
    const body = await me.json();
    assert.equal(body.legacy, false);
    assert.equal(body.profile.name, "Аня");
  });
});

test("POST /backup доступен только legacy token", async () => {
  await withServer(async (base) => {
    const noAuth = await fetch(`${base}/backup`, { method: "POST" });
    assert.equal(noAuth.status, 401);
    const ok = await fetch(`${base}/backup`, { method: "POST", headers: authH });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true, path: null });
  });
});

async function createRoom(base, overrides = {}) {
  const res = await fetch(`${base}/rooms`, {
    method: "POST",
    headers: { ...authH, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Winter Arc",
      durationDays: 90,
      startDate: "2026-07-02",
      strict: false,
      rules: ["Тренировка каждый день"],
      participantName: "Артём",
      checks: { "2026-07-02": true },
      ...overrides,
    }),
  });
  return { res, body: await res.json() };
}

test("POST /rooms требует токен и создаёт комнату без утечки секретов", async () => {
  await withServer(async (base) => {
    const noAuth = await fetch(`${base}/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "X", durationDays: 7, startDate: "2026-07-02" }),
    });
    assert.equal(noAuth.status, 401);

    const { res, body } = await createRoom(base);
    assert.equal(res.status, 200);
    assert.match(body.code, /^[A-Z0-9]{8}$/);
    assert.match(body.participantId, /^p_/);
    assert.match(body.secret, /^[a-f0-9]{64}$/);
    assert.equal(body.room.participants[body.participantId].name, "Артём");
    assert.equal(body.room.participants[body.participantId].secret, undefined);

    const get = await fetch(`${base}/rooms/${body.code}`);
    assert.equal(get.status, 200);
    const publicBody = await get.json();
    assert.equal(publicBody.room.name, "Winter Arc");
    assert.equal(publicBody.room.participants[body.participantId].secret, undefined);
    assert.equal(publicBody.room.participants[body.participantId].checks["2026-07-02"], true);
  });
});

test("POST /rooms работает с токеном зарегистрированного пользователя", async () => {
  await withServer(async (base) => {
    const reg = await fetch(`${base}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: { name: "Миша" }, state: {} }),
    });
    const user = await reg.json();
    const create = await fetch(`${base}/rooms`, {
      method: "POST",
      headers: { Authorization: `Bearer ${user.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Комната Миши", durationDays: 7, startDate: todayISO() }),
    });
    assert.equal(create.status, 200);
    const body = await create.json();
    assert.equal(body.room.participants[body.participantId].name, "Миша");
  });
});

test("POST /rooms/:code/join добавляет участника и ловит дубли имени", async () => {
  await withServer(async (base) => {
    const { body: created } = await createRoom(base);
    const join = await fetch(`${base}/rooms/${created.code}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Дима" }),
    });
    assert.equal(join.status, 200);
    const joined = await join.json();
    assert.match(joined.participantId, /^p_/);
    assert.match(joined.secret, /^[a-f0-9]{64}$/);
    assert.equal(joined.room.participants[joined.participantId].name, "Дима");

    const dup = await fetch(`${base}/rooms/${created.code}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "дима" }),
    });
    assert.equal(dup.status, 409);
  });
});

test("POST /rooms/:code/join возвращает 409 при переполнении", async () => {
  await withServer(async (base) => {
    const { body: created } = await createRoom(base);
    for (let i = 0; i < 9; i++) {
      const join = await fetch(`${base}/rooms/${created.code}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Друг " + i }),
      });
      assert.equal(join.status, 200);
    }
    const overflow = await fetch(`${base}/rooms/${created.code}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Лишний" }),
    });
    assert.equal(overflow.status, 409);
  });
});

test("POST /rooms/:code/checkin проверяет секрет и дату", async () => {
  await withServer(async (base) => {
    const today = todayISO();
    const { body: created } = await createRoom(base, { startDate: today, durationDays: 30 });
    const badSecret = await fetch(`${base}/rooms/${created.code}/checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: created.participantId, secret: "bad", date: today, done: true }),
    });
    assert.equal(badSecret.status, 401);

    const beforeStart = await fetch(`${base}/rooms/${created.code}/checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: created.participantId, secret: created.secret, date: addDays(today, -1), done: true }),
    });
    assert.equal(beforeStart.status, 400);

    const future = await fetch(`${base}/rooms/${created.code}/checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: created.participantId, secret: created.secret, date: "2999-01-01", done: true }),
    });
    assert.equal(future.status, 400);

    const ok = await fetch(`${base}/rooms/${created.code}/checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: created.participantId, secret: created.secret, date: today, done: true }),
    });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.room.participants[created.participantId].checks[today], true);
  });
});

test("POST /rooms/:code/leave останавливает участника", async () => {
  await withServer(async (base) => {
    const { body: created } = await createRoom(base);
    const leave = await fetch(`${base}/rooms/${created.code}/leave`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: created.participantId, secret: created.secret }),
    });
    assert.equal(leave.status, 200);
    const body = await leave.json();
    assert.equal(body.room.participants[created.participantId].status, "stopped");
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
