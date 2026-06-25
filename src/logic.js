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

// Номер дня челленджа считается от startDate (день 1). Fallback на anchorDate
// для старых данных без startDate.
export function challengeDayNumber(challenge, todayISO) {
  const start = challenge.startDate || challenge.anchorDate;
  return daysSince(start, todayISO) + 1;
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

// Текущая серия. Не обнуляется, если сегодня ещё не отмечено: серия «жива»,
// пока не пропущен прошедший день. Считаем от сегодня (если отмечено) либо
// от вчера (если сегодня ещё пусто), затем назад по последовательным дням.
export function habitStreak(days, habitId, refISO) {
  const done = (iso) => !!(days[iso] && days[iso].habits && days[iso].habits[habitId]);
  let start;
  if (done(refISO)) start = refISO;
  else {
    const yesterday = addDays(refISO, -1);
    if (done(yesterday)) start = yesterday;
    else return 0;
  }
  let streak = 0;
  let cursor = start;
  while (done(cursor)) {
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

// Калории по дням (для графика). Берёт day.nutrition.kcal, пропускает дни без записи.
export function caloriesPerDay(days) {
  return Object.keys(days)
    .sort()
    .map((date) => {
      const n = days[date].nutrition;
      return { date, value: n && n.kcal ? n.kcal : 0 };
    })
    .filter((p) => p.value > 0);
}

// --- Дефолтный стейт и стартовые данные ---

export function defaultState() {
  const SEED = "2026-06-25"; // день первичной настройки — якорь для стартовых серий

  const exTurnik = { id: "turnik", name: "Турник", type: "reps", preset: true };
  const exBrusya = { id: "brusya", name: "Брусья", type: "reps", preset: true };
  const habits = [
    { id: "fr", name: "Французский" },
    { id: "chess", name: "Шахматы" },
    { id: "pushups", name: "10 отжиманий" },
    { id: "meditation", name: "Медитация" },
  ];

  const days = {};
  const ensure = (iso) => (days[iso] || (days[iso] = { workouts: [], habits: {}, note: "" }));
  const seedStreak = (habitId, count, endISO) => {
    for (let i = 0; i < count; i++) ensure(addDays(endISO, -i)).habits[habitId] = true;
  };
  const addWorkout = (iso, turnik, brusya) => {
    ensure(iso).workouts = [
      { exerciseId: "turnik", name: "Турник", type: "reps", sets: turnik },
      { exerciseId: "brusya", name: "Брусья", type: "reps", sets: brusya },
    ];
  };

  seedStreak("fr", 151, SEED); // включая сегодня
  seedStreak("chess", 110, SEED); // включая сегодня
  seedStreak("meditation", 63, addDays(SEED, -1)); // не включая сегодня (ещё не сделано)
  seedStreak("pushups", 7, SEED); // включая сегодня

  addWorkout("2026-06-21", [6, 4, 4, 2, 4], [5, 4, 4, 5, 6]);
  addWorkout("2026-06-22", [2, 3, 2, 3, 3], [8, 3, 5, 3, 3]);
  addWorkout("2026-06-23", [2, 2, 3, 2, 2], [4, 7, 7, 6, 5]);
  addWorkout("2026-06-24", [3, 5, 6, 4, 5], [4, 7, 8, 6, 6]);

  return {
    settings: {
      noAlcoholStart: "2025-09-27",
      noSpraysStart: "2026-05-02",
      challenge: { anchorDate: "2026-06-22", remainingAtAnchor: 75, startDate: "2026-06-21" },
      weighIn: { anchorDate: "2026-06-22", intervalDays: 14 },
    },
    exercises: [exTurnik, exBrusya],
    habits,
    weighIns: [{ date: "2026-06-22", weight: 78.8 }],
    days,
  };
}
