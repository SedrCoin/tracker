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
