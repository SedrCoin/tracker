# Трекер тренировок и привычек — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Собрать офлайн-PWA для iPhone, в которую владелец каждый день записывает тренировки/привычки/вес, и которая считает счётчики и строит графики.

**Architecture:** Чистый HTML/CSS/JS без сборки. Вся чистая логика (даты, счётчики, стрики, агрегация, сидинг) вынесена в ES-модуль `src/logic.js`, тестируется через `node --test`. UI рендерится в `src/app.js` и проверяется вручную в браузере. Данные — в `localStorage`. Офлайн — через service worker.

**Tech Stack:** Vanilla JS (ES modules), SVG для графиков, localStorage, PWA (manifest + service worker). Тесты — встроенный `node --test`. Без внешних зависимостей.

---

## Файловая структура

```
package.json          — { "type": "module" } (для node --test и ES-модулей)
index.html            — разметка, контейнеры экранов, таб-бар
styles.css            — тема Duolingo-в-стиле-iOS
src/logic.js          — чистые функции: даты, счётчики, стрики, weigh-in, агрегация, дефолтный/сид-стейт
src/storage.js        — load/save/export/import поверх localStorage
src/charts.js         — построение SVG-графиков (возвращают строки SVG)
src/app.js            — состояние UI, рендер экранов, обработчики событий
manifest.json         — PWA-манифест
sw.js                 — service worker (офлайн-кэш)
icons/icon-192.png, icons/icon-512.png — иконки
test/logic.test.js    — тесты чистой логики (node --test)
README.md             — как запустить локально и задеплоить на GitHub Pages
```

Принцип: `logic.js` не трогает DOM и работает и в Node, и в браузере. `app.js` импортирует `logic.js`, `storage.js`, `charts.js`.

---

### Task 1: Скелет проекта и smoke-тест

**Files:**
- Create: `package.json`
- Create: `src/logic.js`
- Create: `test/logic.test.js`

- [ ] **Step 1: Создать package.json**

```json
{
  "name": "tracker",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: Создать src/logic.js с заглушкой**

```js
// src/logic.js — чистая логика, работает в Node и в браузере (без DOM).
export function hello() {
  return "ok";
}
```

- [ ] **Step 3: Написать smoke-тест**

```js
// test/logic.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { hello } from "../src/logic.js";

test("smoke", () => {
  assert.equal(hello(), "ok");
});
```

- [ ] **Step 4: Запустить тесты — должны пройти**

Run: `npm test`
Expected: PASS, 1 test passed.

- [ ] **Step 5: Commit**

```bash
git add package.json src/logic.js test/logic.test.js
git commit -m "chore: скелет проекта и smoke-тест"
```

---

### Task 2: Помощники по датам

Работаем с датами как со строками `YYYY-MM-DD` в локальном времени, чтобы не ловить сдвиги часовых поясов.

**Files:**
- Modify: `src/logic.js`
- Modify: `test/logic.test.js`

- [ ] **Step 1: Написать падающие тесты**

```js
import { parseISO, toISO, addDays, daysBetween } from "../src/logic.js";

test("toISO форматирует дату", () => {
  assert.equal(toISO(new Date(2026, 5, 25)), "2026-06-25"); // месяц 5 = июнь
});

test("parseISO -> toISO роундтрип", () => {
  assert.equal(toISO(parseISO("2026-06-22")), "2026-06-22");
});

test("addDays через границу месяца", () => {
  assert.equal(addDays("2026-06-22", 14), "2026-07-06");
});

test("daysBetween считает целые дни", () => {
  assert.equal(daysBetween("2026-06-22", "2026-06-25"), 3);
  assert.equal(daysBetween("2026-06-25", "2026-06-22"), -3);
});
```

- [ ] **Step 2: Запустить — должны упасть**

Run: `npm test`
Expected: FAIL (функции не определены).

- [ ] **Step 3: Реализовать в src/logic.js**

```js
export function parseISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function toISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(iso, n) {
  const dt = parseISO(iso);
  dt.setDate(dt.getDate() + n);
  return toISO(dt);
}

export function daysBetween(fromISO, toISOArg) {
  const ms = parseISO(toISOArg) - parseISO(fromISO);
  return Math.round(ms / 86400000);
}
```

- [ ] **Step 4: Запустить — должны пройти**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/logic.js test/logic.test.js
git commit -m "feat: помощники по датам"
```

---

### Task 3: Логика счётчиков

**Files:**
- Modify: `src/logic.js`
- Modify: `test/logic.test.js`

- [ ] **Step 1: Написать падающие тесты**

```js
import { challengeRemaining, challengeDayNumber, daysSince } from "../src/logic.js";

const challenge = { anchorDate: "2026-06-22", remainingAtAnchor: 75 };

test("остаток челленджа на якоре = 75", () => {
  assert.equal(challengeRemaining(challenge, "2026-06-22"), 75);
});

test("остаток челленджа на 25.06 = 72", () => {
  assert.equal(challengeRemaining(challenge, "2026-06-25"), 72);
});

test("остаток не уходит ниже 0", () => {
  assert.equal(challengeRemaining(challenge, "2026-12-31"), 0);
});

test("номер дня челленджа = 75 - остаток + 1", () => {
  assert.equal(challengeDayNumber(challenge, "2026-06-22"), 1);
  assert.equal(challengeDayNumber(challenge, "2026-06-25"), 4);
});

test("daysSince считает прошедшие дни", () => {
  assert.equal(daysSince("2026-05-02", "2026-06-25"), 54);
  assert.equal(daysSince("2026-06-25", "2026-06-25"), 0);
});
```

- [ ] **Step 2: Запустить — упадут**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 3: Реализовать**

```js
export function challengeRemaining(challenge, todayISO) {
  const elapsed = daysBetween(challenge.anchorDate, todayISO);
  return Math.max(0, challenge.remainingAtAnchor - elapsed);
}

export function challengeDayNumber(challenge, todayISO) {
  return challenge.remainingAtAnchor - challengeRemaining(challenge, todayISO) + 1;
}

export function daysSince(startISO, todayISO) {
  return Math.max(0, daysBetween(startISO, todayISO));
}
```

- [ ] **Step 4: Запустить — пройдут**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/logic.js test/logic.test.js
git commit -m "feat: логика счётчиков (челлендж, дни трезвости)"
```

---

### Task 4: Расписание взвешивания

**Files:**
- Modify: `src/logic.js`
- Modify: `test/logic.test.js`

- [ ] **Step 1: Падающие тесты**

```js
import { isWeighInDay, nextWeighInDate, lastWeighInValue } from "../src/logic.js";

const w = { anchorDate: "2026-06-22", intervalDays: 14 };

test("день взвешивания на якоре и через 14 дней", () => {
  assert.equal(isWeighInDay(w, "2026-06-22"), true);
  assert.equal(isWeighInDay(w, "2026-07-06"), true);
  assert.equal(isWeighInDay(w, "2026-06-25"), false);
});

test("следующее взвешивание от 25.06 = 06.07", () => {
  assert.equal(nextWeighInDate(w, "2026-06-25"), "2026-07-06");
});

test("следующее взвешивание, когда сегодня день взвешивания, = сегодня", () => {
  assert.equal(nextWeighInDate(w, "2026-07-06"), "2026-07-06");
});

test("последний вес берётся из самой свежей записи <= сегодня", () => {
  const weighIns = [
    { date: "2026-06-22", weight: 78.8 },
    { date: "2026-07-06", weight: 78.1 },
  ];
  assert.equal(lastWeighInValue(weighIns, "2026-06-30"), 78.8);
  assert.equal(lastWeighInValue(weighIns, "2026-07-10"), 78.1);
  assert.equal(lastWeighInValue([], "2026-07-10"), null);
});
```

- [ ] **Step 2: Запустить — упадут**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 3: Реализовать**

```js
export function isWeighInDay(weighIn, todayISO) {
  const elapsed = daysBetween(weighIn.anchorDate, todayISO);
  return elapsed >= 0 && elapsed % weighIn.intervalDays === 0;
}

export function nextWeighInDate(weighIn, todayISO) {
  const elapsed = daysBetween(weighIn.anchorDate, todayISO);
  if (elapsed < 0) return weighIn.anchorDate;
  const rem = elapsed % weighIn.intervalDays;
  if (rem === 0) return todayISO;
  return addDays(todayISO, weighIn.intervalDays - rem);
}

export function lastWeighInValue(weighIns, todayISO) {
  const past = weighIns
    .filter((x) => daysBetween(x.date, todayISO) >= 0)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  return past.length ? past[0].weight : null;
}
```

- [ ] **Step 4: Запустить — пройдут**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/logic.js test/logic.test.js
git commit -m "feat: расписание взвешивания"
```

---

### Task 5: Стрики привычек

**Files:**
- Modify: `src/logic.js`
- Modify: `test/logic.test.js`

- [ ] **Step 1: Падающие тесты**

```js
import { habitStreak } from "../src/logic.js";

// days: { iso: { habits: { habitId: bool } } }
const days = {
  "2026-06-23": { habits: { fr: true } },
  "2026-06-24": { habits: { fr: true } },
  "2026-06-25": { habits: { fr: true } },
};

test("стрик считает дни подряд до сегодня включительно", () => {
  assert.equal(habitStreak(days, "fr", "2026-06-25"), 3);
});

test("стрик 0, если сегодня не отмечено", () => {
  assert.equal(habitStreak(days, "fr", "2026-06-26"), 0);
});

test("стрик прерывается на пропуске", () => {
  const d = { "2026-06-23": { habits: { fr: true } }, "2026-06-25": { habits: { fr: true } } };
  assert.equal(habitStreak(d, "fr", "2026-06-25"), 1);
});
```

- [ ] **Step 2: Запустить — упадут**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 3: Реализовать**

```js
export function habitStreak(days, habitId, todayISO) {
  let streak = 0;
  let cursor = todayISO;
  while (days[cursor] && days[cursor].habits && days[cursor].habits[habitId]) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}
```

- [ ] **Step 4: Запустить — пройдут**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/logic.js test/logic.test.js
git commit -m "feat: стрики привычек"
```

---

### Task 6: Агрегация для статистики

**Files:**
- Modify: `src/logic.js`
- Modify: `test/logic.test.js`

- [ ] **Step 1: Падающие тесты**

```js
import { repsPerDay, totalWorkouts } from "../src/logic.js";

const days = {
  "2026-06-21": { workouts: [
    { name: "Турник", type: "reps", sets: [6,4,4,2,4] },
    { name: "Брусья", type: "reps", sets: [5,4,4,5,6] },
  ] },
  "2026-06-22": { workouts: [
    { name: "Турник", type: "reps", sets: [2,3,2,3,3] },
  ] },
};

test("repsPerDay суммирует подходы по упражнению и сортирует по дате", () => {
  const series = repsPerDay(days, "Турник");
  assert.deepEqual(series, [
    { date: "2026-06-21", value: 20 },
    { date: "2026-06-22", value: 13 },
  ]);
});

test("totalWorkouts считает дни, где была хотя бы одна тренировка", () => {
  assert.equal(totalWorkouts(days), 2);
});
```

- [ ] **Step 2: Запустить — упадут**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 3: Реализовать**

```js
export function repsPerDay(days, exerciseName) {
  return Object.keys(days)
    .sort()
    .map((date) => {
      const w = (days[date].workouts || []).find(
        (x) => x.name === exerciseName && x.type === "reps"
      );
      const value = w ? (w.sets || []).reduce((a, b) => a + b, 0) : 0;
      return { date, value };
    })
    .filter((p) => p.value > 0);
}

export function totalWorkouts(days) {
  return Object.values(days).filter(
    (d) => (d.workouts || []).length > 0
  ).length;
}
```

- [ ] **Step 4: Запустить — пройдут**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/logic.js test/logic.test.js
git commit -m "feat: агрегация статистики"
```

---

### Task 7: Дефолтный стейт и сидинг

**Files:**
- Modify: `src/logic.js`
- Modify: `test/logic.test.js`

- [ ] **Step 1: Падающие тесты**

```js
import { defaultState } from "../src/logic.js";

test("дефолтный стейт содержит настройки счётчиков", () => {
  const s = defaultState();
  assert.equal(s.settings.noAlcoholStart, "2025-09-27");
  assert.equal(s.settings.noSpraysStart, "2026-05-02");
  assert.equal(s.settings.challenge.anchorDate, "2026-06-22");
  assert.equal(s.settings.challenge.remainingAtAnchor, 75);
  assert.equal(s.settings.weighIn.intervalDays, 14);
});

test("4 привычки и 2 пресета-упражнения", () => {
  const s = defaultState();
  assert.equal(s.habits.length, 4);
  assert.equal(s.exercises.filter((e) => e.preset).length, 2);
});

test("сид-данные: 4 дня тренировок и вес 78.8", () => {
  const s = defaultState();
  assert.equal(Object.keys(s.days).length, 4);
  assert.deepEqual(s.days["2026-06-21"].workouts[0].sets, [6,4,4,2,4]);
  assert.deepEqual(s.days["2026-06-24"].workouts[1].sets, [4,7,8,6,6]);
  assert.equal(s.weighIns[0].weight, 78.8);
  assert.equal(s.weighIns[0].date, "2026-06-22");
});
```

- [ ] **Step 2: Запустить — упадут**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 3: Реализовать**

```js
function uid(prefix) {
  // детерминированных id достаточно для пресетов; уникальность не критична
  return prefix;
}

export function defaultState() {
  const exTurnik = { id: "turnik", name: "Турник", type: "reps", preset: true };
  const exBrusya = { id: "brusya", name: "Брусья", type: "reps", preset: true };
  const habits = [
    { id: "fr", name: "Французский" },
    { id: "chess", name: "Шахматы" },
    { id: "pushups", name: "10 отжиманий" },
    { id: "meditation", name: "Медитация" },
  ];
  const mkDay = (turnik, brusya) => ({
    workouts: [
      { exerciseId: "turnik", name: "Турник", type: "reps", sets: turnik },
      { exerciseId: "brusya", name: "Брусья", type: "reps", sets: brusya },
    ],
    habits: {},
    note: "",
  });
  return {
    settings: {
      noAlcoholStart: "2025-09-27",
      noSpraysStart: "2026-05-02",
      challenge: { anchorDate: "2026-06-22", remainingAtAnchor: 75 },
      weighIn: { anchorDate: "2026-06-22", intervalDays: 14 },
    },
    exercises: [exTurnik, exBrusya],
    habits,
    weighIns: [{ date: "2026-06-22", weight: 78.8 }],
    days: {
      "2026-06-21": mkDay([6,4,4,2,4], [5,4,4,5,6]),
      "2026-06-22": mkDay([2,3,2,3,3], [8,3,5,3,3]),
      "2026-06-23": mkDay([2,2,3,2,2], [4,7,7,6,5]),
      "2026-06-24": mkDay([3,5,6,4,5], [4,7,8,6,6]),
    },
  };
}
```

- [ ] **Step 4: Запустить — пройдут**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/logic.js test/logic.test.js
git commit -m "feat: дефолтный стейт и стартовые данные"
```

---

### Task 8: Хранилище (localStorage + экспорт/импорт)

`storage.js` зависит от `localStorage`, поэтому тестируем чистую часть — сериализацию/валидацию — передавая стораджу мок-объект.

**Files:**
- Create: `src/storage.js`
- Modify: `test/logic.test.js` (добавить блок тестов storage через мок)

- [ ] **Step 1: Падающие тесты**

```js
import { createStore } from "../src/storage.js";

function memStorage() {
  const m = {};
  return {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: (k) => { delete m[k]; },
  };
}

test("createStore сидит дефолт при пустом хранилище", () => {
  const store = createStore(memStorage());
  assert.equal(store.get().settings.challenge.remainingAtAnchor, 75);
});

test("save/get сохраняет изменения", () => {
  const ls = memStorage();
  const store = createStore(ls);
  const s = store.get();
  s.days["2026-06-25"] = { workouts: [], habits: {}, note: "тест" };
  store.set(s);
  const store2 = createStore(ls);
  assert.equal(store2.get().days["2026-06-25"].note, "тест");
});

test("export -> import роундтрип", () => {
  const store = createStore(memStorage());
  const json = store.exportJSON();
  const target = createStore(memStorage());
  target.importJSON(json);
  assert.equal(target.get().weighIns[0].weight, 78.8);
});

test("importJSON отклоняет мусор", () => {
  const store = createStore(memStorage());
  assert.throws(() => store.importJSON("{not json"));
  assert.throws(() => store.importJSON(JSON.stringify({ foo: 1 })));
});
```

- [ ] **Step 2: Запустить — упадут**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 3: Реализовать src/storage.js**

```js
import { defaultState } from "./logic.js";

const KEY = "tracker.state.v1";

function isValidState(s) {
  return s && typeof s === "object" && s.settings && s.days && Array.isArray(s.habits)
    && Array.isArray(s.exercises) && Array.isArray(s.weighIns);
}

export function createStore(ls) {
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
  }
  function exportJSON() {
    return JSON.stringify(get(), null, 2);
  }
  function importJSON(text) {
    const parsed = JSON.parse(text); // бросит на невалидном JSON
    if (!isValidState(parsed)) throw new Error("Не похоже на бэкап трекера");
    set(parsed);
  }
  return { get, set, exportJSON, importJSON };
}
```

- [ ] **Step 4: Запустить — пройдут**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/storage.js test/logic.test.js
git commit -m "feat: хранилище localStorage + экспорт/импорт"
```

---

### Task 9: HTML-скелет, таб-бар и базовая тема

**Files:**
- Create: `index.html`
- Create: `styles.css`
- Create: `src/app.js`

- [ ] **Step 1: Создать index.html**

```html
<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="default" />
  <meta name="theme-color" content="#58CC02" />
  <link rel="manifest" href="manifest.json" />
  <link rel="apple-touch-icon" href="icons/icon-192.png" />
  <link rel="stylesheet" href="styles.css" />
  <title>Трекер</title>
</head>
<body>
  <main id="screen-today" class="screen"></main>
  <main id="screen-stats" class="screen hidden"></main>
  <main id="screen-settings" class="screen hidden"></main>
  <nav id="tabbar">
    <button data-tab="today" class="tab active">📅<span>Сегодня</span></button>
    <button data-tab="stats" class="tab">📊<span>Статистика</span></button>
    <button data-tab="settings" class="tab">⚙️<span>Настройки</span></button>
  </nav>
  <script type="module" src="src/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Создать styles.css (тема Duolingo-в-стиле-iOS)**

```css
:root {
  --green: #58cc02; --green-dark: #58a700;
  --blue: #1cb0f6; --blue-dark: #1899d6;
  --orange: #ff9600; --orange-dark: #e08600;
  --purple: #ce82ff; --purple-dark: #a568cc;
  --red: #ff4b4b;
  --bg: #f7f9fc; --card: #ffffff; --text: #3c3c3c; --muted: #8e8e93;
  --radius: 18px; --shadow-lift: 0 4px 0;
}
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
html, body { margin: 0; background: var(--bg); color: var(--text);
  font-family: -apple-system, "SF Pro Rounded", system-ui, sans-serif; }
body { padding-bottom: calc(72px + env(safe-area-inset-bottom)); }
.screen { padding: calc(env(safe-area-inset-top) + 12px) 16px 16px; max-width: 640px; margin: 0 auto; }
.hidden { display: none; }
h1 { font-size: 26px; font-weight: 800; margin: 8px 0 16px; }
.card { background: var(--card); border-radius: var(--radius); padding: 16px;
  margin-bottom: 14px; box-shadow: 0 2px 8px rgba(0,0,0,.06); }
.btn { border: none; border-radius: 16px; padding: 14px 18px; font-size: 17px;
  font-weight: 700; color: #fff; background: var(--green);
  box-shadow: var(--shadow-lift) var(--green-dark); cursor: pointer; transition: transform .05s; }
.btn:active { transform: translateY(2px); box-shadow: 0 2px 0 var(--green-dark); }
.btn.blue { background: var(--blue); box-shadow: var(--shadow-lift) var(--blue-dark); }
.btn.ghost { background: #eef1f6; color: var(--text); box-shadow: 0 2px 0 #d7dce4; }
#tabbar { position: fixed; bottom: 0; left: 0; right: 0; display: flex;
  background: #fff; border-top: 1px solid #e6e9ef; padding-bottom: env(safe-area-inset-bottom);
  z-index: 10; }
.tab { flex: 1; background: none; border: none; padding: 10px 0; font-size: 22px;
  color: var(--muted); display: flex; flex-direction: column; align-items: center; gap: 2px; }
.tab span { font-size: 11px; font-weight: 700; }
.tab.active { color: var(--green); }
```

- [ ] **Step 3: Создать src/app.js — переключение вкладок**

```js
import { createStore } from "./storage.js";
import * as L from "./logic.js";

const store = createStore(window.localStorage);

const screens = {
  today: document.getElementById("screen-today"),
  stats: document.getElementById("screen-stats"),
  settings: document.getElementById("screen-settings"),
};

function show(tab) {
  for (const [name, el] of Object.entries(screens)) el.classList.toggle("hidden", name !== tab);
  document.querySelectorAll(".tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.tab === tab));
  if (tab === "today") renderToday();
  if (tab === "stats") renderStats();
  if (tab === "settings") renderSettings();
}

document.querySelectorAll(".tab").forEach((t) =>
  t.addEventListener("click", () => show(t.dataset.tab)));

// Заглушки — наполняются в следующих задачах.
function renderToday() { screens.today.innerHTML = "<h1>Сегодня</h1>"; }
function renderStats() { screens.stats.innerHTML = "<h1>Статистика</h1>"; }
function renderSettings() { screens.settings.innerHTML = "<h1>Настройки</h1>"; }

show("today");
```

- [ ] **Step 4: Проверить вручную в браузере**

Запустить `python3 -m http.server 8000` в корне проекта, открыть `http://localhost:8000`.
Expected: видны три вкладки, переключаются, на каждой свой заголовок, таб-бар прибит снизу.

- [ ] **Step 5: Commit**

```bash
git add index.html styles.css src/app.js
git commit -m "feat: HTML-скелет, таб-бар, базовая тема"
```

---

### Task 10: Экран «Сегодня» — счётчики и взвешивание

**Files:**
- Modify: `src/app.js`

- [ ] **Step 1: Добавить состояние текущего дня и рендер счётчиков**

В `src/app.js` добавить вверху (после создания store):

```js
function todayISO() {
  const d = new Date();
  return L.toISO(d);
}
let currentDay = todayISO(); // выбранный на экране «Сегодня» день
```

Заменить `renderToday` на версию со счётчиками и взвешиванием:

```js
function counterCard(title, big, small, color) {
  return `<div class="card counter ${color}">
    <div class="counter-title">${title}</div>
    <div class="counter-big">${big}</div>
    <div class="counter-small">${small}</div></div>`;
}

function renderToday() {
  const s = store.get();
  const today = todayISO();
  const ch = s.settings.challenge;
  const rem = L.challengeRemaining(ch, today);
  const dayNo = L.challengeDayNumber(ch, today);
  const noAlco = L.daysSince(s.settings.noAlcoholStart, today);
  const noSpray = L.daysSince(s.settings.noSpraysStart, today);

  const w = s.settings.weighIn;
  const isWeigh = L.isWeighInDay(w, today);
  const nextW = L.nextWeighInDate(w, today);
  const lastW = L.lastWeighInValue(s.weighIns, today);
  const weighPanel = `<div class="card weigh ${isWeigh ? "due" : ""}">
    <div class="counter-title">⚖️ Взвешивание</div>
    <div class="counter-big">${lastW != null ? lastW + " кг" : "—"}</div>
    <div class="counter-small">${isWeigh ? "Сегодня день взвешивания!" : "Следующее: " + nextW}</div>
    ${isWeigh ? `<div class="weigh-input"><input id="weigh-val" type="number" step="0.1" inputmode="decimal" placeholder="кг" />
      <button class="btn blue" id="weigh-save">Записать</button></div>` : ""}
  </div>`;

  screens.today.innerHTML = `
    <h1>Сегодня</h1>
    <div class="counters">
      ${counterCard("🔥 Челлендж", "Осталось " + rem, "День " + dayNo + " из 75", "green")}
      ${counterCard("🍺 Без алкоголя", noAlco + " дн.", "с " + s.settings.noAlcoholStart, "blue")}
      ${counterCard("💨 Без спреев", noSpray + " дн.", "с " + s.settings.noSpraysStart, "purple")}
    </div>
    ${weighPanel}
    <div id="today-workouts"></div>
    <div id="today-habits"></div>
    <div id="today-note"></div>
  `;

  if (isWeigh) {
    document.getElementById("weigh-save").addEventListener("click", () => {
      const val = parseFloat(document.getElementById("weigh-val").value);
      if (!isFinite(val)) return;
      const st = store.get();
      st.weighIns = st.weighIns.filter((x) => x.date !== today);
      st.weighIns.push({ date: today, weight: val });
      store.set(st);
      renderToday();
    });
  }
}
```

- [ ] **Step 2: Добавить стили счётчиков в styles.css**

```css
.counters { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
.counters .counter:first-child { grid-column: 1 / -1; }
.counter { color: #fff; }
.counter.green { background: var(--green); }
.counter.blue { background: var(--blue); }
.counter.purple { background: var(--purple); }
.counter-title { font-size: 14px; font-weight: 700; opacity: .95; }
.counter-big { font-size: 30px; font-weight: 800; margin: 4px 0; }
.counter-small { font-size: 13px; opacity: .9; }
.weigh.due { outline: 3px solid var(--orange); }
.weigh-input { display: flex; gap: 8px; margin-top: 10px; }
.weigh-input input { flex: 1; font-size: 18px; padding: 12px; border-radius: 12px;
  border: 2px solid #e6e9ef; }
```

- [ ] **Step 3: Проверить вручную**

Перезагрузить страницу. Expected: челлендж показывает «Осталено 72 / День 4 из 75» (при системной дате 25.06.2026; иначе — пересчитано от сегодня), счётчики трезвости считают дни, плашка взвешивания показывает 78.8 кг и дату следующего. В день взвешивания появляется поле ввода.

- [ ] **Step 4: Commit**

```bash
git add src/app.js styles.css
git commit -m "feat: экран Сегодня — счётчики и взвешивание"
```

---

### Task 11: Экран «Сегодня» — запись тренировки

**Files:**
- Modify: `src/app.js`
- Modify: `styles.css`

- [ ] **Step 1: Рендер тренировок выбранного дня**

Добавить в `src/app.js` функцию и вызвать её в конце `renderToday` (после установки innerHTML):

```js
function getDay(state, iso) {
  if (!state.days[iso]) state.days[iso] = { workouts: [], habits: {}, note: "" };
  return state.days[iso];
}

function renderWorkouts() {
  const s = store.get();
  const day = getDay(s, currentDay);
  const presets = s.exercises.map((e) =>
    `<button class="chip" data-add-ex="${e.id}">${e.name}</button>`).join("");
  const list = (day.workouts || []).map((w, i) => {
    if (w.type === "cardio") {
      return `<div class="wk"><b>${w.name}</b>
        <input class="cardio" data-wk="${i}" value="${w.value || ""}" placeholder="5 км / 30 мин" />
        <button class="x" data-del-wk="${i}">✕</button></div>`;
    }
    const sets = (w.sets || []).map((r, si) =>
      `<input class="set" type="number" inputmode="numeric" data-wk="${i}" data-set="${si}" value="${r}" />`).join("");
    return `<div class="wk"><b>${w.name}</b>
      <div class="sets">${sets}
        <button class="set-add" data-addset="${i}">＋</button></div>
      <button class="x" data-del-wk="${i}">✕</button></div>`;
  }).join("");

  document.getElementById("today-workouts").innerHTML = `
    <div class="card">
      <div class="section-title">🏋️ Тренировка</div>
      <div class="chips">${presets}<button class="chip ghost" id="add-custom">＋ своё</button></div>
      <div class="wk-list">${list}</div>
    </div>`;

  wireWorkoutEvents();
}

function wireWorkoutEvents() {
  document.querySelectorAll("[data-add-ex]").forEach((b) =>
    b.addEventListener("click", () => {
      const s = store.get();
      const ex = s.exercises.find((e) => e.id === b.dataset.addEx);
      const day = getDay(s, currentDay);
      day.workouts.push(ex.type === "cardio"
        ? { exerciseId: ex.id, name: ex.name, type: "cardio", value: "" }
        : { exerciseId: ex.id, name: ex.name, type: "reps", sets: [0] });
      store.set(s); renderWorkouts();
    }));

  document.getElementById("add-custom").addEventListener("click", () => {
    const name = prompt("Название упражнения?");
    if (!name) return;
    const isCardio = confirm("Это кардио (бег и т.п.)? OK — да, Отмена — подходы×повторы");
    const s = store.get();
    const day = getDay(s, currentDay);
    day.workouts.push(isCardio
      ? { name, type: "cardio", value: "" }
      : { name, type: "reps", sets: [0] });
    store.set(s); renderWorkouts();
  });

  document.querySelectorAll("input.set").forEach((inp) =>
    inp.addEventListener("change", () => {
      const s = store.get();
      const day = getDay(s, currentDay);
      day.workouts[+inp.dataset.wk].sets[+inp.dataset.set] = parseInt(inp.value, 10) || 0;
      store.set(s);
    }));

  document.querySelectorAll("input.cardio").forEach((inp) =>
    inp.addEventListener("change", () => {
      const s = store.get();
      getDay(s, currentDay).workouts[+inp.dataset.wk].value = inp.value;
      store.set(s);
    }));

  document.querySelectorAll("[data-addset]").forEach((b) =>
    b.addEventListener("click", () => {
      const s = store.get();
      getDay(s, currentDay).workouts[+b.dataset.addset].sets.push(0);
      store.set(s); renderWorkouts();
    }));

  document.querySelectorAll("[data-del-wk]").forEach((b) =>
    b.addEventListener("click", () => {
      const s = store.get();
      getDay(s, currentDay).workouts.splice(+b.dataset.delWk, 1);
      store.set(s); renderWorkouts();
    }));
}
```

В конце `renderToday()` добавить вызов: `renderWorkouts();`

- [ ] **Step 2: Стили для тренировки**

```css
.section-title { font-size: 16px; font-weight: 800; margin-bottom: 10px; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
.chip { border: none; background: var(--green); color: #fff; font-weight: 700;
  padding: 10px 14px; border-radius: 999px; box-shadow: 0 2px 0 var(--green-dark); }
.chip.ghost { background: #eef1f6; color: var(--text); box-shadow: 0 2px 0 #d7dce4; }
.wk { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 0;
  border-top: 1px solid #f0f2f6; }
.wk b { min-width: 70px; }
.sets { display: flex; gap: 6px; flex-wrap: wrap; flex: 1; }
.set { width: 48px; text-align: center; font-size: 16px; padding: 8px 0;
  border: 2px solid #e6e9ef; border-radius: 10px; }
.cardio { flex: 1; padding: 8px; border: 2px solid #e6e9ef; border-radius: 10px; }
.set-add { width: 40px; border: 2px dashed #cfd5df; background: none; border-radius: 10px;
  font-size: 18px; color: var(--muted); }
.x { margin-left: auto; border: none; background: none; color: var(--red);
  font-size: 16px; font-weight: 800; }
```

- [ ] **Step 3: Проверить вручную**

Expected: видны кнопки Турник/Брусья и «＋ своё». На сид-днях (переключение в Task 12) видны подходы. Нажатие пресета добавляет упражнение с одним полем подхода; «＋» добавляет подход; правка чисел сохраняется (перезагрузка не теряет); ✕ удаляет; «＋ своё» с кардио даёт текстовое поле.

- [ ] **Step 4: Commit**

```bash
git add src/app.js styles.css
git commit -m "feat: экран Сегодня — запись тренировки (пресеты, подходы, кардио)"
```

---

### Task 12: «Сегодня» — привычки, заметка, навигация по дням, конфетти

**Files:**
- Modify: `src/app.js`
- Modify: `styles.css`

- [ ] **Step 1: Навигация по дням — добавить в заголовок renderToday**

Заменить строку `<h1>Сегодня</h1>` в `renderToday` на навигатор и переименовать переменную дня:

```js
// вверху renderToday, вместо использования today для заголовка:
const label = currentDay === todayISO() ? "Сегодня" : currentDay;
// ... в шаблоне:
`<div class="day-nav">
  <button class="navbtn" id="day-prev">‹</button>
  <h1>${label}</h1>
  <button class="navbtn" id="day-next">›</button>
</div>`
```

И повесить обработчики (в конце renderToday):

```js
document.getElementById("day-prev").addEventListener("click", () => {
  currentDay = L.addDays(currentDay, -1); renderToday();
});
document.getElementById("day-next").addEventListener("click", () => {
  currentDay = L.addDays(currentDay, 1); renderToday();
});
```

Примечание: счётчики и плашка взвешивания считаются от реального `today`, а тренировки/привычки/заметка — от `currentDay`.

- [ ] **Step 2: Привычки и заметка**

```js
function renderHabits() {
  const s = store.get();
  const day = getDay(s, currentDay);
  const today = todayISO();
  const items = s.habits.map((h) => {
    const done = !!(day.habits && day.habits[h.id]);
    const streak = L.habitStreak(s.days, h.id, currentDay);
    return `<button class="habit ${done ? "done" : ""}" data-habit="${h.id}">
      <span>${done ? "✅" : "⬜️"} ${h.name}</span>
      <span class="streak">${streak > 0 ? "🔥 " + streak : ""}</span></button>`;
  }).join("");
  document.getElementById("today-habits").innerHTML =
    `<div class="card"><div class="section-title">✨ Привычки</div>${items}</div>`;

  document.querySelectorAll("[data-habit]").forEach((b) =>
    b.addEventListener("click", () => {
      const st = store.get();
      const d = getDay(st, currentDay);
      d.habits[b.dataset.habit] = !d.habits[b.dataset.habit];
      store.set(st);
      const allDone = st.habits.every((h) => d.habits[h.id]);
      renderHabits();
      if (allDone && currentDay === today) celebrate();
    }));
}

function renderNote() {
  const s = store.get();
  const day = getDay(s, currentDay);
  document.getElementById("today-note").innerHTML =
    `<div class="card"><div class="section-title">📝 Заметка</div>
     <textarea id="note-area" rows="3" placeholder="как прошёл день…">${day.note || ""}</textarea></div>`;
  document.getElementById("note-area").addEventListener("change", (e) => {
    const st = store.get();
    getDay(st, currentDay).note = e.target.value;
    store.set(st);
  });
}

function celebrate() {
  const layer = document.createElement("div");
  layer.className = "confetti";
  for (let i = 0; i < 30; i++) {
    const p = document.createElement("i");
    p.style.left = (i / 30 * 100) + "%";
    p.style.background = ["#58cc02","#1cb0f6","#ff9600","#ce82ff","#ff4b4b"][i % 5];
    p.style.animationDelay = (i % 10) * 0.05 + "s";
    layer.appendChild(p);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 1600);
}
```

В конце `renderToday()` добавить вызовы: `renderHabits(); renderNote();`

- [ ] **Step 3: Стили (навигация, привычки, конфетти)**

```css
.day-nav { display: flex; align-items: center; justify-content: space-between; }
.navbtn { border: none; background: #eef1f6; width: 44px; height: 44px; border-radius: 14px;
  font-size: 24px; color: var(--text); }
.habit { width: 100%; display: flex; justify-content: space-between; align-items: center;
  padding: 14px 12px; margin-top: 8px; border: none; border-radius: 14px; background: #f4f6fa;
  font-size: 16px; font-weight: 700; color: var(--text); }
.habit.done { background: #e8f8dd; }
.streak { color: var(--orange); }
textarea { width: 100%; border: 2px solid #e6e9ef; border-radius: 12px; padding: 10px;
  font: inherit; resize: vertical; }
.confetti { position: fixed; inset: 0; pointer-events: none; overflow: hidden; z-index: 50; }
.confetti i { position: absolute; top: -10px; width: 10px; height: 14px; border-radius: 2px;
  animation: fall 1.4s linear forwards; }
@keyframes fall { to { transform: translateY(110vh) rotate(540deg); opacity: .2; } }
```

- [ ] **Step 4: Проверить вручную**

Expected: стрелки ‹ › переключают день (на 21–24.06 видны засеянные тренировки); тап по привычке ставит ✅ и показывает 🔥-стрик; заметка сохраняется; при отметке всех привычек за сегодня сыплется конфетти.

- [ ] **Step 5: Commit**

```bash
git add src/app.js styles.css
git commit -m "feat: привычки, заметка, навигация по дням, конфетти"
```

---

### Task 13: Экран «Статистика» — SVG-графики

**Files:**
- Create: `src/charts.js`
- Modify: `src/app.js`
- Modify: `styles.css`

- [ ] **Step 1: Создать src/charts.js**

```js
// Возвращают строки SVG. points: [{date, value}].
export function lineChart(points, color = "#1cb0f6", w = 320, h = 140) {
  if (points.length === 0) return `<svg viewBox="0 0 ${w} ${h}"></svg>`;
  const pad = 24;
  const xs = points.map((_, i) => pad + (i * (w - 2 * pad)) / Math.max(1, points.length - 1));
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const y = (v) => h - pad - ((v - min) / span) * (h - 2 * pad);
  const d = points.map((p, i) => `${i ? "L" : "M"}${xs[i].toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const dots = points.map((p, i) =>
    `<circle cx="${xs[i].toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3.5" fill="${color}" />`).join("");
  return `<svg viewBox="0 0 ${w} ${h}" class="chart">
    <path d="${d}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    ${dots}</svg>`;
}

export function barChart(points, color = "#58cc02", w = 320, h = 140) {
  if (points.length === 0) return `<svg viewBox="0 0 ${w} ${h}"></svg>`;
  const pad = 24;
  const max = Math.max(...points.map((p) => p.value)) || 1;
  const bw = (w - 2 * pad) / points.length * 0.7;
  const gap = (w - 2 * pad) / points.length;
  const bars = points.map((p, i) => {
    const bh = (p.value / max) * (h - 2 * pad);
    const x = pad + i * gap + (gap * 0.15);
    return `<rect x="${x.toFixed(1)}" y="${(h - pad - bh).toFixed(1)}" width="${bw.toFixed(1)}"
      height="${bh.toFixed(1)}" rx="3" fill="${color}" />`;
  }).join("");
  return `<svg viewBox="0 0 ${w} ${h}" class="chart">${bars}</svg>`;
}
```

- [ ] **Step 2: Рендер статистики в app.js**

Добавить импорт вверху: `import * as Charts from "./charts.js";`

```js
function renderStats() {
  const s = store.get();
  const exNames = [...new Set(
    Object.values(s.days).flatMap((d) => (d.workouts || [])
      .filter((w) => w.type === "reps").map((w) => w.name)))];
  const exBlocks = exNames.map((name) => {
    const series = L.repsPerDay(s.days, name);
    return `<div class="card"><div class="section-title">${name} — повторов за день</div>
      ${Charts.barChart(series, "#58cc02")}</div>`;
  }).join("");

  const weightSeries = [...s.weighIns].sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((x) => ({ date: x.date, value: x.weight }));

  screens.stats.innerHTML = `
    <h1>Статистика</h1>
    <div class="card"><div class="section-title">Всего тренировок</div>
      <div class="counter-big" style="color:var(--green)">${L.totalWorkouts(s.days)}</div></div>
    ${exBlocks}
    <div class="card"><div class="section-title">⚖️ Вес</div>
      ${Charts.lineChart(weightSeries, "#1cb0f6")}</div>
    <div id="habit-cal"></div>
  `;
  renderHabitCalendar();
}

function renderHabitCalendar() {
  const s = store.get();
  const today = todayISO();
  const days = [];
  for (let i = 13; i >= 0; i--) days.push(L.addDays(today, -i)); // последние 14 дней
  const rows = s.habits.map((h) => {
    const cells = days.map((iso) => {
      const done = s.days[iso] && s.days[iso].habits && s.days[iso].habits[h.id];
      return `<span class="cal-cell ${done ? "on" : ""}"></span>`;
    }).join("");
    return `<div class="cal-row"><span class="cal-name">${h.name}</span><div class="cal-cells">${cells}</div></div>`;
  }).join("");
  document.getElementById("habit-cal").innerHTML =
    `<div class="card"><div class="section-title">Привычки за 14 дней</div>${rows}</div>`;
}
```

- [ ] **Step 3: Стили графиков и календаря**

```css
.chart { width: 100%; height: auto; }
.cal-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.cal-name { width: 110px; font-size: 13px; font-weight: 700; }
.cal-cells { display: flex; gap: 3px; flex: 1; }
.cal-cell { flex: 1; aspect-ratio: 1; border-radius: 4px; background: #ececf1; }
.cal-cell.on { background: var(--green); }
```

- [ ] **Step 4: Проверить вручную**

Expected: на вкладке «Статистика» — «Всего тренировок: 4», столбчатые графики Турник/Брусья (с суммами повторов засеянных дней), линия веса с точкой 78.8, и сетка привычек за 14 дней.

- [ ] **Step 5: Commit**

```bash
git add src/charts.js src/app.js styles.css
git commit -m "feat: экран Статистика — SVG-графики и календарь привычек"
```

---

### Task 14: Экран «Настройки» — даты, упражнения, привычки, экспорт/импорт

**Files:**
- Modify: `src/app.js`
- Modify: `styles.css`

- [ ] **Step 1: Рендер настроек**

```js
function renderSettings() {
  const s = store.get();
  screens.settings.innerHTML = `
    <h1>Настройки</h1>
    <div class="card"><div class="section-title">Счётчики</div>
      <label>Без алкоголя с<input type="date" id="set-alco" value="${s.settings.noAlcoholStart}"></label>
      <label>Без спреев с<input type="date" id="set-spray" value="${s.settings.noSpraysStart}"></label>
      <label>Челлендж: якорь<input type="date" id="set-ch-anchor" value="${s.settings.challenge.anchorDate}"></label>
      <label>Челлендж: остаток на якоре<input type="number" id="set-ch-rem" value="${s.settings.challenge.remainingAtAnchor}"></label>
      <label>Взвешивание: якорь<input type="date" id="set-w-anchor" value="${s.settings.weighIn.anchorDate}"></label>
      <label>Взвешивание: интервал (дней)<input type="number" id="set-w-int" value="${s.settings.weighIn.intervalDays}"></label>
      <button class="btn" id="save-settings">Сохранить</button>
      <button class="btn ghost" id="reset-alco">Сброс «без алко» на сегодня</button>
      <button class="btn ghost" id="reset-spray">Сброс «без спреев» на сегодня</button>
    </div>
    <div class="card"><div class="section-title">Упражнения</div>
      <div id="ex-list"></div>
      <button class="btn ghost" id="add-ex-preset">＋ упражнение</button></div>
    <div class="card"><div class="section-title">Привычки</div>
      <div id="habit-list"></div>
      <button class="btn ghost" id="add-habit">＋ привычка</button></div>
    <div class="card"><div class="section-title">Бэкап</div>
      <button class="btn blue" id="export">Экспорт в файл</button>
      <button class="btn ghost" id="import">Импорт из файла</button>
      <input type="file" id="import-file" accept="application/json" hidden></div>
  `;
  wireSettings();
}

function wireSettings() {
  const today = todayISO();
  document.getElementById("save-settings").addEventListener("click", () => {
    const s = store.get();
    s.settings.noAlcoholStart = document.getElementById("set-alco").value;
    s.settings.noSpraysStart = document.getElementById("set-spray").value;
    s.settings.challenge.anchorDate = document.getElementById("set-ch-anchor").value;
    s.settings.challenge.remainingAtAnchor = parseInt(document.getElementById("set-ch-rem").value, 10);
    s.settings.weighIn.anchorDate = document.getElementById("set-w-anchor").value;
    s.settings.weighIn.intervalDays = parseInt(document.getElementById("set-w-int").value, 10);
    store.set(s); alert("Сохранено");
  });
  document.getElementById("reset-alco").addEventListener("click", () => {
    if (!confirm("Обнулить счётчик «без алкоголя» на сегодня?")) return;
    const s = store.get(); s.settings.noAlcoholStart = today; store.set(s); renderSettings();
  });
  document.getElementById("reset-spray").addEventListener("click", () => {
    if (!confirm("Обнулить счётчик «без спреев» на сегодня?")) return;
    const s = store.get(); s.settings.noSpraysStart = today; store.set(s); renderSettings();
  });

  renderEditableList("ex-list", "exercises", "add-ex-preset", "упражнения");
  renderEditableList("habit-list", "habits", "add-habit", "привычки");

  document.getElementById("export").addEventListener("click", exportData);
  document.getElementById("import").addEventListener("click", () =>
    document.getElementById("import-file").click());
  document.getElementById("import-file").addEventListener("change", importData);
}

function renderEditableList(containerId, key, addBtnId, label) {
  const s = store.get();
  document.getElementById(containerId).innerHTML = s[key].map((item, i) =>
    `<div class="edit-row"><input data-key="${key}" data-i="${i}" value="${item.name}" />
     <button class="x" data-del="${key}" data-i="${i}">✕</button></div>`).join("");
  document.querySelectorAll(`#${containerId} input`).forEach((inp) =>
    inp.addEventListener("change", () => {
      const st = store.get(); st[inp.dataset.key][+inp.dataset.i].name = inp.value; store.set(st);
    }));
  document.querySelectorAll(`#${containerId} [data-del]`).forEach((b) =>
    b.addEventListener("click", () => {
      const st = store.get(); st[b.dataset.del].splice(+b.dataset.i, 1); store.set(st); renderSettings();
    }));
  document.getElementById(addBtnId).addEventListener("click", () => {
    const name = prompt("Название?"); if (!name) return;
    const st = store.get();
    const id = name.toLowerCase().replace(/\s+/g, "-") + "-" + st[key].length;
    if (key === "exercises") st.exercises.push({ id, name, type: "reps", preset: false });
    else st.habits.push({ id, name });
    store.set(st); renderSettings();
  });
}

function exportData() {
  const blob = new Blob([store.exportJSON()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "tracker-backup-" + todayISO() + ".json";
  a.click(); URL.revokeObjectURL(url);
}

function importData(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try { store.importJSON(reader.result); alert("Импортировано"); show("today"); }
    catch (err) { alert("Не удалось импортировать: " + err.message); }
  };
  reader.readAsText(file);
}
```

- [ ] **Step 2: Стили настроек**

```css
label { display: flex; justify-content: space-between; align-items: center; gap: 10px;
  margin: 8px 0; font-size: 14px; font-weight: 600; }
label input { padding: 8px; border: 2px solid #e6e9ef; border-radius: 10px; font: inherit; }
.card .btn { display: block; width: 100%; margin-top: 10px; }
.edit-row { display: flex; gap: 8px; margin: 6px 0; }
.edit-row input { flex: 1; padding: 8px; border: 2px solid #e6e9ef; border-radius: 10px; }
```

- [ ] **Step 3: Проверить вручную**

Expected: можно поменять даты и сохранить (счётчики на «Сегодня» пересчитываются); «Сброс» обнуляет с подтверждением; упражнения/привычки добавляются/переименовываются/удаляются; «Экспорт» скачивает JSON; «Импорт» восстанавливает из него; импорт мусора показывает ошибку, а не ломает данные.

- [ ] **Step 4: Commit**

```bash
git add src/app.js styles.css
git commit -m "feat: экран Настройки — даты, списки, экспорт/импорт"
```

---

### Task 15: PWA — манифест, иконки, офлайн

**Files:**
- Create: `manifest.json`
- Create: `sw.js`
- Create: `icons/icon-192.png`, `icons/icon-512.png`
- Modify: `src/app.js`

- [ ] **Step 1: manifest.json**

```json
{
  "name": "Трекер",
  "short_name": "Трекер",
  "start_url": ".",
  "display": "standalone",
  "background_color": "#f7f9fc",
  "theme_color": "#58cc02",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

- [ ] **Step 2: Сгенерировать иконки**

Сгенерировать два PNG (зелёный фон #58cc02 с белой гантелей/галочкой). Команда (требует ImageMagick; если нет — создать любым редактором):

```bash
mkdir -p icons
magick -size 512x512 xc:'#58cc02' -gravity center -pointsize 280 -fill white label:'🏋️' icons/icon-512.png
magick icons/icon-512.png -resize 192x192 icons/icon-192.png
```

Expected: два файла в `icons/`. (Если эмодзи не рендерится — допустимо сделать однотонный квадрат с буквой «Т».)

- [ ] **Step 3: sw.js (офлайн-кэш)**

```js
const CACHE = "tracker-v1";
const ASSETS = [
  ".", "index.html", "styles.css",
  "src/app.js", "src/logic.js", "src/storage.js", "src/charts.js",
  "manifest.json", "icons/icon-192.png", "icons/icon-512.png",
];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
```

- [ ] **Step 4: Зарегистрировать SW в app.js**

Добавить в конец `src/app.js`:

```js
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js"));
}
```

- [ ] **Step 5: Проверить вручную**

Запустить локальный сервер, открыть в браузере, в DevTools → Application проверить регистрацию SW и манифест. Перезагрузить с офлайн-режимом — приложение открывается.

- [ ] **Step 6: Commit**

```bash
git add manifest.json sw.js icons src/app.js
git commit -m "feat: PWA — манифест, иконки, офлайн service worker"
```

---

### Task 16: README, финальная проверка и деплой

**Files:**
- Create: `README.md`

- [ ] **Step 1: Прогнать все тесты**

Run: `npm test`
Expected: все тесты проходят.

- [ ] **Step 2: Создать README.md**

````markdown
# Трекер тренировок и привычек

PWA для iPhone: тренировки, привычки, вес, счётчики (челлендж и дни трезвости).

## Локально
```bash
python3 -m http.server 8000
# открыть http://localhost:8000
```

## Тесты
```bash
npm test
```

## Деплой на GitHub Pages
1. Создать репозиторий на GitHub, запушить эту папку.
2. Settings → Pages → Source: ветка `main`, папка `/ (root)`.
3. Открыть выданный URL на iPhone в Safari → «Поделиться» → «На экран Домой».

## Бэкап
Настройки → Экспорт. Раз в неделю сохранять файл в iCloud. Восстановление — Импорт.
````

- [ ] **Step 3: Финальная ручная проверка по критериям готовности**

Пройти по чеклисту спеки: офлайн-открытие, запись за сегодня и прошлый день, корректность счётчиков (челлендж = 72 на 25.06), статистика, экспорт/импорт, наличие сид-данных.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README с инструкциями по запуску и деплою"
```

---

## Self-Review (выполнено при написании плана)

- **Покрытие спеки:** счётчики (T3), взвешивание (T4), стрики (T5), статистика (T6, T13), сидинг (T7), хранилище/бэкап (T8, T14), экраны Сегодня/Статистика/Настройки (T10–T14), визуал Duolingo/iOS (T9 тема + по экранам), PWA/офлайн (T15), деплой (T16). Все разделы спеки покрыты.
- **Плейсхолдеры:** нет — каждый шаг содержит реальный код/команды.
- **Согласованность имён:** `defaultState`, `createStore(get/set/exportJSON/importJSON)`, `challengeRemaining/challengeDayNumber/daysSince`, `isWeighInDay/nextWeighInDate/lastWeighInValue`, `habitStreak`, `repsPerDay/totalWorkouts`, `toISO/parseISO/addDays/daysBetween`, `getDay`, `renderToday/renderStats/renderSettings` — используются одинаково во всех задачах.
