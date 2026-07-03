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

// Итоги питания за день (сумма по приёмам пищи). Поддерживает и старый
// формат { kcal, p, f, c } без meals.
export function dayNutritionTotals(day) {
  const n = day && day.nutrition;
  if (!n) return { kcal: 0, p: 0, f: 0, c: 0 };
  if (!n.meals) {
    return { kcal: n.kcal || 0, p: n.p || 0, f: n.f || 0, c: n.c || 0 };
  }
  const t = { kcal: 0, p: 0, f: 0, c: 0 };
  for (const key of Object.keys(n.meals)) {
    for (const e of n.meals[key] || []) {
      t.kcal += e.kcal || 0;
      t.p += e.p || 0;
      t.f += e.f || 0;
      t.c += e.c || 0;
    }
  }
  return {
    kcal: Math.round(t.kcal),
    p: Math.round(t.p * 10) / 10,
    f: Math.round(t.f * 10) / 10,
    c: Math.round(t.c * 10) / 10,
  };
}

// Калории по дням (для графика). Пропускает дни без питания.
export function caloriesPerDay(days) {
  return Object.keys(days)
    .sort()
    .map((date) => ({ date, value: dayNutritionTotals(days[date]).kcal }))
    .filter((p) => p.value > 0);
}

export function lastMeasurementValue(measurements, key, todayISO) {
  const past = measurements
    .filter((x) => x[key] != null && daysBetween(x.date, todayISO) >= 0)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  return past.length ? past[0][key] : null;
}

// --- Дефолтный стейт ---

export function defaultState() {
  const today = toISO(new Date());

  return {
    settings: {
      counters: [],
      profile: { name: "", height: null, weight: null, photo: "", measurements: {} },
      challenge: { anchorDate: today, remainingAtAnchor: 75, startDate: today, targetDays: 75, enabled: false, photoUrl: "" },
      weighIn: { anchorDate: today, intervalDays: 14 },
    },
    exercises: [],
    habits: [],
    weighIns: [],
    measurements: [],
    days: {},
  };
}
