import { defaultState } from "./logic.js";

const KEY = "tracker.state.v2";
const META_KEY = "tracker.meta.v2";
const PERSONAL_COUNTER_IDS = new Set(["no-alcohol", "no-sprays"]);
const PERSONAL_HABITS = new Map([
  ["fr", "Французский"],
  ["chess", "Шахматы"],
  ["pushups", "10 отжиманий"],
  ["meditation", "Медитация"],
]);
const PERSONAL_WORKOUTS = {
  "2026-06-21": { turnik: [6, 4, 4, 2, 4], brusya: [5, 4, 4, 5, 6] },
  "2026-06-22": { turnik: [2, 3, 2, 3, 3], brusya: [8, 3, 5, 3, 3] },
  "2026-06-23": { turnik: [2, 2, 3, 2, 2], brusya: [4, 7, 7, 6, 5] },
  "2026-06-24": { turnik: [3, 5, 6, 4, 5], brusya: [4, 7, 8, 6, 6] },
};

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function normName(name) {
  return String(name || "").trim().toLowerCase().replace(/ё/g, "е");
}

function isOwnerProfile(profile) {
  const name = normName(profile && profile.name);
  return name.includes("артем") || name.includes("artem");
}

function sameNumberArray(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Number(v) === Number(b[i]));
}

function isPersonalCounter(c) {
  return (
    (c && c.id === "no-alcohol" && c.name === "Без алкоголя" && c.startDate === "2025-09-27") ||
    (c && c.id === "no-sprays" && c.name === "Без спреев" && c.startDate === "2026-05-02")
  );
}

function isPersonalChallenge(ch) {
  return !!(
    ch &&
    ch.anchorDate === "2026-06-22" &&
    ch.startDate === "2026-06-21" &&
    Number(ch.remainingAtAnchor) === 75 &&
    Number(ch.targetDays || 75) === 75 &&
    (ch.enabled === true || ch.enabled == null)
  );
}

function isPersonalHabit(h) {
  return !!(h && PERSONAL_HABITS.get(h.id) === h.name);
}

function isPersonalExercise(ex) {
  return !!(
    (ex && ex.id === "turnik" && ex.name === "Турник") ||
    (ex && ex.id === "brusya" && ex.name === "Брусья")
  );
}

function isPersonalWorkout(date, workout) {
  const byDate = PERSONAL_WORKOUTS[date];
  if (!byDate || !workout || workout.type !== "reps") return false;
  return sameNumberArray(workout.sets, byDate[workout.exerciseId]);
}

function hasPersonalStarterData(s) {
  return !!(
    s.settings.noAlcoholStart === "2025-09-27" ||
    s.settings.noSpraysStart === "2026-05-02" ||
    isPersonalChallenge(s.settings.challenge) ||
    (Array.isArray(s.settings.counters) && s.settings.counters.some(isPersonalCounter)) ||
    (Array.isArray(s.habits) && s.habits.some(isPersonalHabit)) ||
    (Array.isArray(s.exercises) && s.exercises.some(isPersonalExercise)) ||
    (Array.isArray(s.weighIns) && s.weighIns.some((w) => w.date === "2026-06-22" && Number(w.weight) === 78.8))
  );
}

function stripPersonalStarterData(s) {
  let changed = false;
  if (!hasPersonalStarterData(s) || isOwnerProfile(s.settings.profile)) return false;

  if (s.settings.noAlcoholStart === "2025-09-27") {
    delete s.settings.noAlcoholStart;
    changed = true;
  }
  if (s.settings.noSpraysStart === "2026-05-02") {
    delete s.settings.noSpraysStart;
    changed = true;
  }
  if (Array.isArray(s.settings.counters)) {
    const next = s.settings.counters.filter((c) => !isPersonalCounter(c));
    if (next.length !== s.settings.counters.length) {
      s.settings.counters = next;
      changed = true;
    }
  }
  if (isPersonalChallenge(s.settings.challenge)) {
    const today = todayISO();
    s.settings.challenge = { enabled: false, startDate: today, anchorDate: today, remainingAtAnchor: 75, targetDays: 75, photoUrl: "" };
    changed = true;
  }

  const removedHabitIds = new Set();
  if (Array.isArray(s.habits)) {
    const next = s.habits.filter((h) => {
      if (!isPersonalHabit(h)) return true;
      removedHabitIds.add(h.id);
      return false;
    });
    if (next.length !== s.habits.length) {
      s.habits = next;
      changed = true;
    }
  }

  const remainingWorkoutIds = new Set();
  if (s.days && typeof s.days === "object") {
    for (const [date, day] of Object.entries(s.days)) {
      if (!day || typeof day !== "object") continue;
      if (day.habits && removedHabitIds.size) {
        for (const id of removedHabitIds) {
          if (id in day.habits) {
            delete day.habits[id];
            changed = true;
          }
        }
      }
      if (Array.isArray(day.workouts)) {
        const next = day.workouts.filter((w) => !isPersonalWorkout(date, w));
        if (next.length !== day.workouts.length) {
          day.workouts = next;
          changed = true;
        }
        for (const w of day.workouts) {
          if (w && w.exerciseId) remainingWorkoutIds.add(w.exerciseId);
        }
      }
      const hasWorkouts = Array.isArray(day.workouts) && day.workouts.length > 0;
      const hasHabits = day.habits && Object.values(day.habits).some(Boolean);
      const hasNote = !!String(day.note || "").trim();
      const hasNutrition = !!day.nutrition;
      if (!hasWorkouts && !hasHabits && !hasNote && !hasNutrition) {
        delete s.days[date];
        changed = true;
      }
    }
  }

  if (Array.isArray(s.exercises)) {
    const next = s.exercises.filter((ex) => !isPersonalExercise(ex) || remainingWorkoutIds.has(ex.id));
    if (next.length !== s.exercises.length) {
      s.exercises = next;
      changed = true;
    }
  }
  if (Array.isArray(s.weighIns)) {
    const next = s.weighIns.filter((w) => !(w.date === "2026-06-22" && Number(w.weight) === 78.8));
    if (next.length !== s.weighIns.length) {
      s.weighIns = next;
      changed = true;
    }
  }
  return changed;
}

function isValidState(s) {
  return (
    s &&
    typeof s === "object" &&
    s.settings &&
    s.days &&
    Array.isArray(s.habits) &&
    Array.isArray(s.exercises) &&
    Array.isArray(s.weighIns) &&
    Array.isArray(s.measurements)
  );
}

function migrateState(s) {
  let changed = false;
  if (!s.settings) s.settings = {};
  const oldPersonalChallenge =
    s.settings.challenge &&
    s.settings.challenge.anchorDate === "2026-06-22" &&
    Number(s.settings.challenge.remainingAtAnchor) === 75;
  if (s.settings && s.settings.challenge && !s.settings.challenge.startDate) {
    s.settings.challenge.startDate = oldPersonalChallenge ? "2026-06-21" : (s.settings.challenge.anchorDate || todayISO());
    changed = true;
  }
  if (s.settings && s.settings.challenge && s.settings.challenge.enabled == null) {
    s.settings.challenge.enabled = !!oldPersonalChallenge;
    changed = true;
  }
  if (s.settings && s.settings.challenge && s.settings.challenge.targetDays == null) {
    s.settings.challenge.targetDays = 75;
    changed = true;
  }
  if (!Array.isArray(s.settings.counters)) {
    s.settings.counters = [];
    if (s.settings.noAlcoholStart) {
      s.settings.counters.push({ id: "no-alcohol", name: "Без алкоголя", startDate: s.settings.noAlcoholStart, tone: "alco" });
    }
    if (s.settings.noSpraysStart) {
      s.settings.counters.push({ id: "no-sprays", name: "Без спреев", startDate: s.settings.noSpraysStart, tone: "spray" });
    }
    changed = true;
  }
  const looksLikeLegacyOwner =
    s.settings.noAlcoholStart === "2025-09-27" ||
    s.settings.noSpraysStart === "2026-05-02" ||
    (s.settings.challenge && s.settings.challenge.anchorDate === "2026-06-22");
  if (!s.settings.profile || typeof s.settings.profile !== "object") {
    s.settings.profile = { name: "", height: null, weight: null, photo: "", measurements: {} };
    changed = true;
  }
  if (looksLikeLegacyOwner && !s.settings.profile.name) {
    const lastWeight = Array.isArray(s.weighIns) && s.weighIns.length
      ? [...s.weighIns].sort((a, b) => (a.date < b.date ? 1 : -1))[0].weight
      : null;
    s.settings.profile = { ...s.settings.profile, name: "Артём", weight: lastWeight || s.settings.profile.weight || null };
    changed = true;
  }
  if (!Array.isArray(s.measurements)) {
    s.measurements = [];
    changed = true;
  }
  if (stripPersonalStarterData(s)) {
    changed = true;
  }
  return changed;
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
    const s = JSON.parse(raw);
    if (migrateState(s)) {
      ls.setItem(KEY, JSON.stringify(s));
    }
    return s;
  }
  function set(state) {
    ls.setItem(KEY, JSON.stringify(state));
    setMeta({ updatedAt: Date.now() });
  }
  function applyRemote(state, updatedAt) {
    const changed = migrateState(state);
    ls.setItem(KEY, JSON.stringify(state));
    setMeta({ updatedAt });
    return changed;
  }
  function exportJSON() {
    return JSON.stringify(get(), null, 2);
  }
  function importJSON(text) {
    const parsed = JSON.parse(text);
    migrateState(parsed);
    if (!isValidState(parsed)) throw new Error("Не похоже на бэкап трекера");
    set(parsed);
  }
  return { get, set, getMeta, applyRemote, exportJSON, importJSON };
}
