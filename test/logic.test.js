import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseISO,
  toISO,
  addDays,
  daysBetween,
  challengeRemaining,
  challengeDayNumber,
  daysSince,
  isWeighInDay,
  nextWeighInDate,
  lastWeighInValue,
  habitStreak,
  repsPerDay,
  totalWorkouts,
  defaultState,
} from "../src/logic.js";
import { createStore } from "../src/storage.js";

// --- Даты ---

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

// --- Счётчики ---

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

// --- Взвешивание ---

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

// --- Стрики ---

const streakDays = {
  "2026-06-23": { habits: { fr: true } },
  "2026-06-24": { habits: { fr: true } },
  "2026-06-25": { habits: { fr: true } },
};

test("стрик считает дни подряд до сегодня включительно", () => {
  assert.equal(habitStreak(streakDays, "fr", "2026-06-25"), 3);
});

test("стрик 0, если сегодня не отмечено", () => {
  assert.equal(habitStreak(streakDays, "fr", "2026-06-26"), 0);
});

test("стрик прерывается на пропуске", () => {
  const d = {
    "2026-06-23": { habits: { fr: true } },
    "2026-06-25": { habits: { fr: true } },
  };
  assert.equal(habitStreak(d, "fr", "2026-06-25"), 1);
});

// --- Агрегация ---

const statDays = {
  "2026-06-21": {
    workouts: [
      { name: "Турник", type: "reps", sets: [6, 4, 4, 2, 4] },
      { name: "Брусья", type: "reps", sets: [5, 4, 4, 5, 6] },
    ],
  },
  "2026-06-22": {
    workouts: [{ name: "Турник", type: "reps", sets: [2, 3, 2, 3, 3] }],
  },
};

test("repsPerDay суммирует подходы по упражнению и сортирует по дате", () => {
  const series = repsPerDay(statDays, "Турник");
  assert.deepEqual(series, [
    { date: "2026-06-21", value: 20 },
    { date: "2026-06-22", value: 13 },
  ]);
});

test("totalWorkouts считает дни, где была хотя бы одна тренировка", () => {
  assert.equal(totalWorkouts(statDays), 2);
});

// --- Дефолтный стейт ---

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
  assert.deepEqual(s.days["2026-06-21"].workouts[0].sets, [6, 4, 4, 2, 4]);
  assert.deepEqual(s.days["2026-06-24"].workouts[1].sets, [4, 7, 8, 6, 6]);
  assert.equal(s.weighIns[0].weight, 78.8);
  assert.equal(s.weighIns[0].date, "2026-06-22");
});

// --- Хранилище ---

function memStorage() {
  const m = {};
  return {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => {
      m[k] = String(v);
    },
    removeItem: (k) => {
      delete m[k];
    },
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
