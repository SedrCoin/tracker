import { defaultState } from "./logic.js";

const KEY = "tracker.state.v2";
const META_KEY = "tracker.meta.v2";

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
  if (s.settings && s.settings.challenge && !s.settings.challenge.startDate) {
    s.settings.challenge.startDate = "2026-06-21";
    changed = true;
  }
  if (s.settings && s.settings.challenge && s.settings.challenge.enabled == null) {
    s.settings.challenge.enabled = true;
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
    migrateState(state);
    ls.setItem(KEY, JSON.stringify(state));
    setMeta({ updatedAt });
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
