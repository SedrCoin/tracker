import { defaultState } from "./logic.js";

const KEY = "tracker.state.v2";

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
