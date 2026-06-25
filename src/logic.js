// src/logic.js — чистая логика, работает и в Node, и в браузере (без DOM).

// --- Даты (работаем со строками YYYY-MM-DD в локальном времени) ---

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

// --- Счётчики ---

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

// --- Взвешивание ---

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

// --- Привычки ---

export function habitStreak(days, habitId, todayISO) {
  let streak = 0;
  let cursor = todayISO;
  while (days[cursor] && days[cursor].habits && days[cursor].habits[habitId]) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

// --- Агрегация для статистики ---

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
  return Object.values(days).filter((d) => (d.workouts || []).length > 0).length;
}

// --- Дефолтный стейт и стартовые данные ---

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
      "2026-06-21": mkDay([6, 4, 4, 2, 4], [5, 4, 4, 5, 6]),
      "2026-06-22": mkDay([2, 3, 2, 3, 3], [8, 3, 5, 3, 3]),
      "2026-06-23": mkDay([2, 2, 3, 2, 2], [4, 7, 7, 6, 5]),
      "2026-06-24": mkDay([3, 5, 6, 4, 5], [4, 7, 8, 6, 6]),
    },
  };
}
