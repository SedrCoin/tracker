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
    Array.isArray(s.weighIns)
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
    const s = JSON.parse(raw);
    // Миграция: старт челленджа (день 1) для состояний, созданных до его появления.
    if (s.settings && s.settings.challenge && !s.settings.challenge.startDate) {
      s.settings.challenge.startDate = "2026-06-21";
      ls.setItem(KEY, JSON.stringify(s));
    }
    return s;
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
