# Бэкенд и синхронизация — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Поднять Node+SQLite-бэкенд для хранения состояния трекера на личном сервере и научить PWA синхронизироваться с ним (с офлайн-кэшем в localStorage).

**Architecture:** Отдельный Node-сервис (`server/`) на чистых встроенных модулях (`node:http`, `node:sqlite`) хранит одно JSON-состояние в SQLite, отдаёт его по токену через REST (`/health`, `/state`). PWA через `src/sync.js` тянет состояние при запуске и пишет с задержкой при изменениях; localStorage остаётся офлайн-кэшем. Наружу сервис выставляется по пути `/trackerapi/` на существующем домене (прокси срезает префикс).

**Tech Stack:** Node ≥ 22.5 (встроенный `node:sqlite`), без внешних зависимостей. Тесты — `node --test` + глобальный `fetch`.

---

## Файловая структура

```
server/
  package.json          { "type": "module" }, скрипты start/test
  config.js             загрузка конфигурации из ENV
  db.js                 SQLite: openDb() → { getState, setState, close }
  auth.js               сравнение Bearer-токена в постоянное время
  rateLimit.js          простой лимитер запросов по IP (инъектируемые часы)
  app.js                createApp(deps) → обработчик (req,res); роутинг, CORS, тело
  index.js              точка входа: config + db + http-сервер
  tracker.service       пример systemd-юнита
  README.md             деплой: nginx/Caddy, токен, запуск
  test/
    config.test.js
    db.test.js
    auth.test.js
    rateLimit.test.js
    app.test.js         интеграционные тесты по HTTP

src/
  sync.js               клиент API: настройки (apiUrl/token), pull/push, chooseNewer
  storage.js            (правка) штамп updatedAt в meta при set()
  app.js                (правка) pull при старте, debounced push, поля и статус синка в Настройках
test/
  logic.test.js         (правка) тесты meta-штампа updatedAt
```

Node реализует маршруты **без** префикса (`/health`, `/state`) — `/trackerapi` срезается прокси.

---

### Task 1: Скелет сервера и конфигурация

**Files:**
- Create: `server/package.json`, `server/config.js`, `server/test/config.test.js`

- [ ] **Step 1: package.json**

```json
{
  "name": "tracker-server",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "start": "node index.js",
    "test": "node --test"
  }
}
```

- [ ] **Step 2: Падающий тест конфигурации**

```js
// server/test/config.test.js
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
  assert.equal(c.dbPath, "./data/tracker.sqlite");
  assert.equal(c.allowOrigin, "https://sedrcoin.github.io");
  assert.equal(c.maxBody, 2_000_000);
});

test("loadConfig читает переопределения", () => {
  const c = loadConfig({ TRACKER_TOKEN: "x", PORT: "9000", DB_PATH: "/tmp/a.db", ALLOW_ORIGIN: "https://e.x", MAX_BODY: "100" });
  assert.equal(c.port, 9000);
  assert.equal(c.dbPath, "/tmp/a.db");
  assert.equal(c.allowOrigin, "https://e.x");
  assert.equal(c.maxBody, 100);
});
```

- [ ] **Step 3: Запустить — упадёт**

Run: `cd server && npm test`
Expected: FAIL (нет `config.js`).

- [ ] **Step 4: Реализовать config.js**

```js
// server/config.js
export function loadConfig(env = process.env) {
  const token = env.TRACKER_TOKEN;
  if (!token) throw new Error("TRACKER_TOKEN is required");
  return {
    token,
    port: Number(env.PORT || 8787),
    dbPath: env.DB_PATH || "./data/tracker.sqlite",
    allowOrigin: env.ALLOW_ORIGIN || "https://sedrcoin.github.io",
    maxBody: Number(env.MAX_BODY || 2_000_000),
  };
}
```

- [ ] **Step 5: Запустить — пройдёт**

Run: `cd server && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/package.json server/config.js server/test/config.test.js
git commit -m "feat(server): скелет и конфигурация"
```

---

### Task 2: Слой SQLite

**Files:**
- Create: `server/db.js`, `server/test/db.test.js`

- [ ] **Step 1: Падающий тест**

```js
// server/test/db.test.js
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
  db.setState({ a: 2 }, 2000); // перезапись одной строки
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
```

- [ ] **Step 2: Запустить — упадёт**

Run: `cd server && npm test`
Expected: FAIL (нет `db.js`).

- [ ] **Step 3: Реализовать db.js**

```js
// server/db.js
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
```

- [ ] **Step 4: Запустить — пройдёт**

Run: `cd server && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/db.js server/test/db.test.js
git commit -m "feat(server): слой SQLite (node:sqlite)"
```

---

### Task 3: Проверка токена

**Files:**
- Create: `server/auth.js`, `server/test/auth.test.js`

- [ ] **Step 1: Падающий тест**

```js
// server/test/auth.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenMatches, extractBearer } from "../auth.js";

test("extractBearer вытаскивает токен", () => {
  assert.equal(extractBearer("Bearer abc"), "abc");
  assert.equal(extractBearer("bearer abc"), "abc");
  assert.equal(extractBearer(undefined), null);
  assert.equal(extractBearer("Basic x"), null);
});

test("tokenMatches сравнивает корректно", () => {
  assert.equal(tokenMatches("secret", "secret"), true);
  assert.equal(tokenMatches("secret", "secre"), false);
  assert.equal(tokenMatches("secret", "wrongg"), false);
  assert.equal(tokenMatches("secret", null), false);
});
```

- [ ] **Step 2: Запустить — упадёт**

Run: `cd server && npm test`
Expected: FAIL.

- [ ] **Step 3: Реализовать auth.js**

```js
// server/auth.js
import { timingSafeEqual } from "node:crypto";

export function extractBearer(headerValue) {
  if (!headerValue) return null;
  const m = /^Bearer\s+(.+)$/i.exec(headerValue);
  return m ? m[1] : null;
}

export function tokenMatches(expected, provided) {
  if (typeof provided !== "string") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false; // timingSafeEqual требует равной длины
  return timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Запустить — пройдёт**

Run: `cd server && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/auth.js server/test/auth.test.js
git commit -m "feat(server): проверка Bearer-токена"
```

---

### Task 4: Лимитер запросов

**Files:**
- Create: `server/rateLimit.js`, `server/test/rateLimit.test.js`

- [ ] **Step 1: Падающий тест**

```js
// server/test/rateLimit.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter } from "../rateLimit.js";

test("пропускает до лимита, блокирует сверх, сбрасывается через окно", () => {
  let now = 0;
  const clock = () => now;
  const limit = createRateLimiter({ max: 3, windowMs: 1000, clock });
  assert.equal(limit("ip1"), true);
  assert.equal(limit("ip1"), true);
  assert.equal(limit("ip1"), true);
  assert.equal(limit("ip1"), false); // 4-й в окне — блок
  assert.equal(limit("ip2"), true);  // другой IP не затронут
  now = 1001;                         // окно прошло
  assert.equal(limit("ip1"), true);
});
```

- [ ] **Step 2: Запустить — упадёт**

Run: `cd server && npm test`
Expected: FAIL.

- [ ] **Step 3: Реализовать rateLimit.js**

```js
// server/rateLimit.js
// Фиксированное окно по IP. clock инъектируется для тестов.
export function createRateLimiter({ max, windowMs, clock = Date.now }) {
  const hits = new Map(); // ip -> { count, windowStart }
  return function allow(ip) {
    const now = clock();
    const rec = hits.get(ip);
    if (!rec || now - rec.windowStart >= windowMs) {
      hits.set(ip, { count: 1, windowStart: now });
      return true;
    }
    if (rec.count >= max) return false;
    rec.count += 1;
    return true;
  };
}
```

- [ ] **Step 4: Запустить — пройдёт**

Run: `cd server && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/rateLimit.js server/test/rateLimit.test.js
git commit -m "feat(server): лимитер запросов по IP"
```

---

### Task 5: HTTP-приложение — health, CORS, 404

**Files:**
- Create: `server/app.js`
- Create: `server/test/app.test.js`

- [ ] **Step 1: Падающий интеграционный тест (health/CORS/404)**

```js
// server/test/app.test.js
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
```

- [ ] **Step 2: Запустить — упадёт**

Run: `cd server && npm test`
Expected: FAIL (нет `app.js`).

- [ ] **Step 3: Реализовать app.js (часть 1: каркас, CORS, health, 404)**

```js
// server/app.js
import { extractBearer, tokenMatches } from "./auth.js";

function sendJson(res, status, obj, cors) {
  res.writeHead(status, { "Content-Type": "application/json", ...cors });
  res.end(JSON.stringify(obj));
}

function readBody(req, maxBody) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > maxBody) {
        reject(Object.assign(new Error("too large"), { code: "TOO_LARGE" }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function createApp({ db, token, allowOrigin, maxBody, allow = () => true }) {
  const cors = {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  };

  return async function handler(req, res) {
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname;

    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    if (req.method === "GET" && path === "/health") {
      sendJson(res, 200, { ok: true }, cors);
      return;
    }

    if (path === "/state") {
      await handleState(req, res, { db, token, maxBody, cors, allow });
      return;
    }

    sendJson(res, 404, { error: "not found" }, cors);
  };
}

// заполняется в следующей задаче
async function handleState() {
  throw new Error("not implemented");
}
```

- [ ] **Step 4: Запустить — health/CORS/404 проходят**

Run: `cd server && npm test`
Expected: health, OPTIONS, 404 — PASS (тесты /state появятся в Task 6).

- [ ] **Step 5: Commit**

```bash
git add server/app.js server/test/app.test.js
git commit -m "feat(server): http-каркас — health, CORS, 404"
```

---

### Task 6: Эндпоинт /state (GET/PUT, авторизация, лимиты)

**Files:**
- Modify: `server/app.js` (заменить `handleState`)
- Modify: `server/test/app.test.js` (добавить тесты)

- [ ] **Step 1: Добавить падающие тесты /state**

Добавить в `server/test/app.test.js`:

```js
const authH = { Authorization: `Bearer ${TOKEN}` };

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
      method: "PUT", headers: { ...authH, "Content-Type": "application/json" },
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
      method: "PUT", headers: { ...authH, "Content-Type": "application/json" }, body: "{не json",
    });
    assert.equal(res.status, 400);
  });
});

test("PUT слишком большого тела → 413", async () => {
  await withServer(async (base) => {
    const big = JSON.stringify({ state: { blob: "x".repeat(5000) }, updatedAt: 1 });
    const res = await fetch(`${base}/state`, {
      method: "PUT", headers: { ...authH, "Content-Type": "application/json" }, body: big,
    });
    assert.equal(res.status, 413);
  });
});
```

- [ ] **Step 2: Запустить — новые тесты упадут**

Run: `cd server && npm test`
Expected: FAIL (`handleState` бросает "not implemented").

- [ ] **Step 3: Реализовать handleState в app.js**

Заменить заглушку `handleState` в `server/app.js` на:

```js
async function handleState(req, res, { db, token, maxBody, cors, allow }) {
  const ip = req.socket.remoteAddress || "unknown";
  if (!allow(ip)) {
    sendJson(res, 429, { error: "rate limited" }, cors);
    return;
  }

  const provided = extractBearer(req.headers["authorization"]);
  if (!tokenMatches(token, provided)) {
    sendJson(res, 401, { error: "unauthorized" }, cors);
    return;
  }

  if (req.method === "GET") {
    sendJson(res, 200, db.getState(), cors);
    return;
  }

  if (req.method === "PUT") {
    let raw;
    try {
      raw = await readBody(req, maxBody);
    } catch (e) {
      if (e.code === "TOO_LARGE") { sendJson(res, 413, { error: "too large" }, cors); return; }
      sendJson(res, 400, { error: "bad body" }, cors);
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      sendJson(res, 400, { error: "invalid json" }, cors);
      return;
    }
    if (!parsed || typeof parsed !== "object" || !("state" in parsed)) {
      sendJson(res, 400, { error: "missing state" }, cors);
      return;
    }
    const incoming = Number(parsed.updatedAt) || 0;
    const updatedAt = Math.max(incoming, Date.now());
    db.setState(parsed.state, updatedAt);
    sendJson(res, 200, { updatedAt }, cors);
    return;
  }

  sendJson(res, 405, { error: "method not allowed" }, cors);
}
```

- [ ] **Step 4: Запустить — все тесты проходят**

Run: `cd server && npm test`
Expected: PASS (config, db, auth, rateLimit, app).

- [ ] **Step 5: Commit**

```bash
git add server/app.js server/test/app.test.js
git commit -m "feat(server): эндпоинт /state (GET/PUT, авторизация, лимиты)"
```

---

### Task 7: Точка входа, systemd, README деплоя

**Files:**
- Create: `server/index.js`, `server/tracker.service`, `server/README.md`, `server/.gitignore`

- [ ] **Step 1: index.js**

```js
// server/index.js
import { createServer } from "node:http";
import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { createApp } from "./app.js";
import { createRateLimiter } from "./rateLimit.js";

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const allow = createRateLimiter({ max: 60, windowMs: 60_000 });
const app = createApp({ db, token: cfg.token, allowOrigin: cfg.allowOrigin, maxBody: cfg.maxBody, allow });

createServer(app).listen(cfg.port, "127.0.0.1", () => {
  console.log(`tracker-server on 127.0.0.1:${cfg.port}, db=${cfg.dbPath}`);
});
```

- [ ] **Step 2: .gitignore (не коммитить базу)**

```
data/
*.sqlite
```

- [ ] **Step 3: systemd-юнит**

```ini
# server/tracker.service — положить в /etc/systemd/system/, поправить пути и токен
[Unit]
Description=Tracker API
After=network.target

[Service]
WorkingDirectory=/opt/tracker/server
ExecStart=/usr/bin/node index.js
Environment=PORT=8787
Environment=DB_PATH=/opt/tracker/server/data/tracker.sqlite
Environment=ALLOW_ORIGIN=https://sedrcoin.github.io
Environment=TRACKER_TOKEN=ЗАМЕНИ_НА_СГЕНЕРИРОВАННЫЙ
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 4: README с инструкцией**

````markdown
# Tracker API (сервер)

Node + SQLite, без внешних зависимостей. Нужен Node ≥ 22.5 (встроенный `node:sqlite`).

## Локально
```bash
TRACKER_TOKEN=dev-token node index.js
# проверка: curl localhost:8787/health -> {"ok":true}
```

## Тесты
```bash
npm test
```

## Деплой без поддомена

1. Скопировать папку `server/` на сервер, напр. в `/opt/tracker/server`.
2. Сгенерировать токен: `openssl rand -hex 32` — сохранить.
3. Положить `tracker.service` в `/etc/systemd/system/tracker.service`, вписать токен и пути:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now tracker
   curl localhost:8787/health   # {"ok":true}
   ```
4. Прокинуть путь `/trackerapi/` в reverse-proxy домена.

   **nginx** — внутри существующего `server { ... }`:
   ```nginx
   location /trackerapi/ {
       proxy_pass http://127.0.0.1:8787/;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-Proto $scheme;
   }
   ```
   затем `sudo nginx -t && sudo systemctl reload nginx`.

   **Caddy** — внутри существующего блока домена:
   ```
   handle_path /trackerapi/* {
       reverse_proxy 127.0.0.1:8787
   }
   ```
   затем `sudo systemctl reload caddy`.

5. Проверить снаружи: `curl https://ТВОЙ-ДОМЕН/trackerapi/health` → `{"ok":true}`.
6. В приложении (Настройки → Синхронизация): адрес `https://ТВОЙ-ДОМЕН/trackerapi`, ключ = токен.

Префикс `/trackerapi/` срезается прокси — Node видит `/health`, `/state`.
````

- [ ] **Step 5: Проверить запуск вручную**

Run: `cd server && TRACKER_TOKEN=dev-token node index.js &` затем `curl -s localhost:8787/health`
Expected: `{"ok":true}`. Остановить процесс после проверки.

- [ ] **Step 6: Commit**

```bash
git add server/index.js server/.gitignore server/tracker.service server/README.md
git commit -m "feat(server): точка входа, systemd, README деплоя"
```

---

### Task 8: Клиент — штамп updatedAt в storage

**Files:**
- Modify: `src/storage.js`
- Modify: `test/logic.test.js` (добавить тесты meta)

- [ ] **Step 1: Падающие тесты meta**

Добавить в `test/logic.test.js` (в конец, рядом с тестами storage):

```js
test("set штампует meta.updatedAt", () => {
  const ls = memStorage();
  const store = createStore(ls);
  const before = Date.now();
  store.set(store.get());
  const meta = store.getMeta();
  assert.ok(meta.updatedAt >= before);
});

test("applyRemote заменяет состояние и ставит updatedAt", () => {
  const store = createStore(memStorage());
  store.applyRemote({ habits: [], exercises: [], weighIns: [], settings: {}, days: {} }, 777);
  assert.equal(store.getMeta().updatedAt, 777);
  assert.deepEqual(store.get().days, {});
});
```

- [ ] **Step 2: Запустить — упадёт**

Run: `npm test` (из корня проекта)
Expected: FAIL (`getMeta`/`applyRemote` не определены).

- [ ] **Step 3: Доработать src/storage.js**

Добавить ключ meta и методы. Полный новый `src/storage.js`:

```js
import { defaultState } from "./logic.js";

const KEY = "tracker.state.v2";
const META_KEY = "tracker.meta.v2";

function isValidState(s) {
  return (
    s && typeof s === "object" && s.settings && s.days &&
    Array.isArray(s.habits) && Array.isArray(s.exercises) && Array.isArray(s.weighIns)
  );
}

export function createStore(ls) {
  function getMeta() {
    const raw = ls.getItem(META_KEY);
    return raw ? JSON.parse(raw) : { updatedAt: 0 };
  }
  function setMeta(meta) {
    ls.setItem(META_KEY, JSON.stringify(meta));
  }
  function get() {
    const raw = ls.getItem(KEY);
    if (!raw) {
      const def = defaultState();
      ls.setItem(KEY, JSON.stringify(def));
      return def;
    }
    return JSON.parse(raw);
  }
  function set(state) {
    ls.setItem(KEY, JSON.stringify(state));
    setMeta({ updatedAt: Date.now() });
  }
  function applyRemote(state, updatedAt) {
    ls.setItem(KEY, JSON.stringify(state));
    setMeta({ updatedAt });
  }
  function exportJSON() {
    return JSON.stringify(get(), null, 2);
  }
  function importJSON(text) {
    const parsed = JSON.parse(text);
    if (!isValidState(parsed)) throw new Error("Не похоже на бэкап трекера");
    set(parsed);
  }
  return { get, set, getMeta, applyRemote, exportJSON, importJSON };
}
```

- [ ] **Step 4: Запустить — пройдёт**

Run: `npm test`
Expected: PASS (все прежние + новые).

- [ ] **Step 5: Commit**

```bash
git add src/storage.js test/logic.test.js
git commit -m "feat: штамп updatedAt в хранилище (под синхронизацию)"
```

---

### Task 9: Клиент — модуль синхронизации

**Files:**
- Create: `src/sync.js`
- Modify: `test/logic.test.js` (тесты chooseNewer)

- [ ] **Step 1: Падающие тесты chooseNewer**

Добавить в `test/logic.test.js`:

```js
import { chooseNewer } from "../src/sync.js";

test("chooseNewer выбирает источник по updatedAt", () => {
  assert.equal(chooseNewer(100, 200), "remote"); // сервер новее
  assert.equal(chooseNewer(300, 200), "local");  // локально новее
  assert.equal(chooseNewer(200, 200), "local");  // равны — оставляем локальное
  assert.equal(chooseNewer(0, 0), "local");      // оба пустые
});
```

- [ ] **Step 2: Запустить — упадёт**

Run: `npm test`
Expected: FAIL (нет `src/sync.js`).

- [ ] **Step 3: Реализовать src/sync.js**

```js
// src/sync.js — клиент синхронизации с бэкендом.
const CFG_KEY = "tracker.sync.cfg.v1";

export function chooseNewer(localUpdatedAt, remoteUpdatedAt) {
  return remoteUpdatedAt > localUpdatedAt ? "remote" : "local";
}

export function loadSyncConfig(ls) {
  const raw = ls.getItem(CFG_KEY);
  return raw ? JSON.parse(raw) : { apiUrl: "", token: "" };
}

export function saveSyncConfig(ls, cfg) {
  ls.setItem(CFG_KEY, JSON.stringify({ apiUrl: cfg.apiUrl || "", token: cfg.token || "" }));
}

export function isConfigured(cfg) {
  return !!(cfg.apiUrl && cfg.token);
}

// fetcher инъектируется (в браузере — window.fetch) для тестируемости.
export function createSyncClient(cfg, fetcher) {
  const base = cfg.apiUrl.replace(/\/$/, "");
  const headers = { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" };
  return {
    async pull() {
      const res = await fetcher(`${base}/state`, { headers });
      if (!res.ok) throw new Error("pull failed: " + res.status);
      return res.json(); // { state, updatedAt }
    },
    async push(state, updatedAt) {
      const res = await fetcher(`${base}/state`, {
        method: "PUT", headers, body: JSON.stringify({ state, updatedAt }),
      });
      if (!res.ok) throw new Error("push failed: " + res.status);
      return res.json(); // { updatedAt }
    },
  };
}
```

- [ ] **Step 4: Добавить тест клиента с мок-fetch**

Добавить в `test/logic.test.js`:

```js
import { createSyncClient } from "../src/sync.js";

test("createSyncClient.pull дергает /state с токеном", async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, json: async () => ({ state: { a: 1 }, updatedAt: 5 }) };
  };
  const client = createSyncClient({ apiUrl: "https://x/trackerapi/", token: "t" }, fakeFetch);
  const out = await client.pull();
  assert.deepEqual(out, { state: { a: 1 }, updatedAt: 5 });
  assert.equal(calls[0].url, "https://x/trackerapi/state"); // хвостовой слэш срезан
  assert.equal(calls[0].opts.headers.Authorization, "Bearer t");
});

test("createSyncClient.push шлёт PUT с телом", async () => {
  let captured;
  const fakeFetch = async (url, opts) => {
    captured = { url, opts };
    return { ok: true, json: async () => ({ updatedAt: 9 }) };
  };
  const client = createSyncClient({ apiUrl: "https://x/trackerapi", token: "t" }, fakeFetch);
  const out = await client.push({ a: 2 }, 9);
  assert.deepEqual(out, { updatedAt: 9 });
  assert.equal(captured.opts.method, "PUT");
  assert.deepEqual(JSON.parse(captured.opts.body), { state: { a: 2 }, updatedAt: 9 });
});
```

- [ ] **Step 5: Запустить — пройдёт**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/sync.js test/logic.test.js
git commit -m "feat: клиентский модуль синхронизации"
```

---

### Task 10: Интеграция синка в приложение + настройки

**Files:**
- Modify: `src/app.js`

- [ ] **Step 1: Импорты и состояние синка**

В начале `src/app.js` после существующих импортов добавить:

```js
import * as Sync from "./sync.js";

let syncCfg = Sync.loadSyncConfig(window.localStorage);
let syncStatus = "idle"; // idle | syncing | ok | offline | error
```

- [ ] **Step 2: Функции pull-при-старте и debounced push**

Добавить в `src/app.js` (рядом с определением store):

```js
function setSyncStatus(s) {
  syncStatus = s;
  const el = document.getElementById("sync-status");
  if (el) el.textContent = syncStatusLabel();
}
function syncStatusLabel() {
  return {
    idle: "не настроено", syncing: "синхронизация…", ok: "синхронизировано",
    offline: "нет сети", error: "ошибка синка",
  }[syncStatus] || "";
}

async function pullOnStart() {
  if (!Sync.isConfigured(syncCfg)) { setSyncStatus("idle"); return; }
  setSyncStatus("syncing");
  try {
    const client = Sync.createSyncClient(syncCfg, window.fetch.bind(window));
    const remote = await client.pull();
    const localUpdatedAt = store.getMeta().updatedAt;
    if (remote.state && Sync.chooseNewer(localUpdatedAt, remote.updatedAt) === "remote") {
      store.applyRemote(remote.state, remote.updatedAt);
    } else {
      await pushNow(); // на сервере пусто/старее — заливаем локальное
    }
    setSyncStatus("ok");
    show("today");
  } catch (e) {
    setSyncStatus("offline");
  }
}

let pushTimer = null;
function schedulePush() {
  if (!Sync.isConfigured(syncCfg)) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushNow, 800);
}
async function pushNow() {
  if (!Sync.isConfigured(syncCfg)) return;
  setSyncStatus("syncing");
  try {
    const client = Sync.createSyncClient(syncCfg, window.fetch.bind(window));
    const { updatedAt } = await client.push(store.get(), store.getMeta().updatedAt);
    store.applyRemote(store.get(), updatedAt); // выровнять локальный updatedAt по серверному
    setSyncStatus("ok");
  } catch (e) {
    setSyncStatus("offline");
  }
}
```

- [ ] **Step 3: Дёргать push при изменениях**

В `src/app.js` найти определение `getDay` и обёртку записи. Самый простой и надёжный приём — обернуть `store.set` локальным хелпером и заменить все вызовы `store.set(` на `saveState(`. Добавить хелпер рядом со store:

```js
function saveState(state) {
  store.set(state);
  schedulePush();
}
```

Затем заменить по файлу все `store.set(` → `saveState(` (кроме определения самого `saveState`). Команда для проверки числа замен:

Run: `grep -c "store.set(" src/app.js`
Expected: после замен — 0 совпадений `store.set(` (все стали `saveState(`).

- [ ] **Step 4: Поля синка в Настройках**

В `renderSettings` (в `src/app.js`) добавить карточку перед карточкой «Бэкап»:

```js
    <div class="card"><div class="eyebrow">Синхронизация · <span id="sync-status">${syncStatusLabel()}</span></div>
      <div class="field">Адрес API<input type="url" id="sync-url" value="${esc(syncCfg.apiUrl)}" placeholder="https://домен/trackerapi"></div>
      <div class="field">Ключ<input type="password" id="sync-token" value="${esc(syncCfg.token)}" placeholder="токен"></div>
      <button class="btn" id="sync-save">Сохранить и синхронизировать</button>
      <button class="btn ghost" id="sync-now">Синхронизировать сейчас</button></div>
```

- [ ] **Step 5: Обработчики синка в wireSettings**

В `wireSettings` (в `src/app.js`) добавить в конец:

```js
  document.getElementById("sync-save").addEventListener("click", async () => {
    syncCfg = { apiUrl: document.getElementById("sync-url").value.trim(), token: document.getElementById("sync-token").value.trim() };
    Sync.saveSyncConfig(window.localStorage, syncCfg);
    await pullOnStart();
    renderSettings();
  });
  document.getElementById("sync-now").addEventListener("click", async () => {
    await pushNow();
    renderSettings();
  });
```

- [ ] **Step 6: Вызвать pull при запуске**

В самом конце `src/app.js`, после `show("today");`, добавить:

```js
pullOnStart();
```

- [ ] **Step 7: Тесты не должны сломаться**

Run: `npm test`
Expected: PASS (логика/синк не затронуты; правки только в app.js, который не тестируется юнитами).

- [ ] **Step 8: Commit**

```bash
git add src/app.js
git commit -m "feat: интеграция синхронизации и настройки синка в UI"
```

---

### Task 11: Сквозная проверка (локальный сервер + PWA)

**Files:** —

- [ ] **Step 1: Запустить сервер локально**

Run: `cd server && TRACKER_TOKEN=dev-token node index.js`
Expected: лог `tracker-server on 127.0.0.1:8787`. `curl -s localhost:8787/health` → `{"ok":true}`.

- [ ] **Step 2: Запустить PWA**

Поднять статику проекта (`python3 -m http.server 8123` в корне) и открыть в превью.
В Настройках → Синхронизация: адрес `http://localhost:8787` (для локальной проверки CORS-origin совпадать не обязан, но если браузер ругнётся — временно выставить `ALLOW_ORIGIN=*` через env сервера), ключ `dev-token`. Нажать «Сохранить и синхронизировать».
Expected: статус «синхронизировано».

- [ ] **Step 3: Проверить запись на сервер**

Изменить что-нибудь (тапнуть привычку), подождать ~1с.
Run: `curl -s -H "Authorization: Bearer dev-token" localhost:8787/state | head -c 200`
Expected: JSON с обновлённым `state` и свежим `updatedAt`.

- [ ] **Step 4: Проверить восстановление**

В DevTools браузера очистить localStorage сайта, перезагрузить, заново ввести адрес/ключ, синхронизировать.
Expected: данные подтянулись с сервера (привычка осталась отмеченной).

- [ ] **Step 5: Финальный прогон тестов**

Run: `npm test && (cd server && npm test)`
Expected: всё зелёное.

- [ ] **Step 6: Commit**

```bash
git commit --allow-empty -m "test: сквозная проверка синхронизации пройдена"
```

---

## Self-Review (выполнено при написании)

- **Покрытие спеки:** Node+SQLite (T2), токен (T3), rate-limit (T4), health/CORS/404 (T5), /state GET/PUT + лимит тела (T6), index/systemd/деплой-README с nginx+Caddy и срезанием префикса (T7), клиентский updatedAt (T8), sync-модуль (T9), интеграция + поля API/ключ + статус + офлайн (T10), сквозная проверка + восстановление (T11). Все разделы спеки покрыты.
- **Плейсхолдеры:** нет — кроме намеренного `ЗАМЕНИ_НА_СГЕНЕРИРОВАННЫЙ` в примере systemd (это значение пользователь подставляет на деплое) и заглушки `handleState`, которая реализуется в той же связке задач (T5→T6).
- **Согласованность имён:** `openDb→{getState,setState,close}`, `createApp({db,token,allowOrigin,maxBody,allow})`, `extractBearer/tokenMatches`, `createRateLimiter({max,windowMs,clock})→allow(ip)`, `createStore→{get,set,getMeta,applyRemote,exportJSON,importJSON}`, `createSyncClient(cfg,fetcher)→{pull,push}`, `chooseNewer/loadSyncConfig/saveSyncConfig/isConfigured` — используются одинаково во всех задачах. Префикс `/trackerapi` срезается прокси, Node маршруты — `/health`,`/state`.
