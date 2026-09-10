import { test } from "node:test";
import assert from "node:assert/strict";
import { MAP_SIZE, MAP_CELLS, collectMapSources, mapProgress, mapRevealOrder, mapArtwork, createProgressMap } from "../src/progress-map.js";

const today = "2026-09-10";
const byId = (sources, id) => sources.find((source) => source.id === id);
const sample = () => ({
  exercises: [{ id: "push", name: "Отжимания", type: "reps" }, { id: "squat", name: "Приседания", type: "reps" }, { id: "run", name: "Бег", type: "cardio" }],
  habits: [{ id: "read", name: "Чтение" }],
  days: {
    "2026-07-01": { workouts: [{ name: "«ОТЖИМАНИЯ»", type: "reps", sets: [15, 10], weights: [20, 20] }, { name: "Турник", type: "reps", sets: [5] }], habits: { read: true } },
    "2026-09-10": { workouts: [{ name: "Отжимания", type: "reps", sets: [20] }, { name: "Бег", type: "cardio", value: "5 км / 30 мин" }, { name: "Бег", type: "cardio", value: "" }], habits: { read: true, removed: true } },
    "2026-09-11": { workouts: [{ name: "Отжимания", type: "reps", sets: [100] }], habits: { read: true } },
  },
});

test("all-time maps combine duplicate exercise names, count every set and retain archived exercises", () => {
  const sources = collectMapSources(sample(), today);
  assert.equal(byId(sources, "all-reps").total, 50);
  assert.equal(byId(sources, "exercise:reps:отжимания").total, 45);
  assert.equal(sources.filter((source) => source.id === "exercise:reps:отжимания").length, 1);
  assert.equal(byId(sources, "exercise:reps:турник").total, 5);
  assert.equal(byId(sources, "exercise:reps:приседания").total, 0);
});

test("cardio, repetitions, habits and challenge days keep distinct units", () => {
  const state = sample();
  state.days[today].workouts.push({ name: "Бег", type: "reps", sets: [7] });
  state.challenges = [{ id: "ch", name: "7 дней", startDate: "2026-09-05", durationDays: 7, checks: { "2026-09-04": true, "2026-09-05": true, "2026-09-09": false, "2026-09-10": true, "2026-09-11": true, "2026-09-13": true } }];
  const sources = collectMapSources(state, today);
  assert.equal(byId(sources, "all-reps").total, 57);
  assert.deepEqual([byId(sources, "exercise:sessions:бег").total, byId(sources, "exercise:sessions:бег").cellsPerUnit], [1, 10]);
  assert.equal(byId(sources, "exercise:reps:бег").total, 7);
  assert.equal(byId(sources, "habit:read").total, 2);
  assert.equal(byId(sources, "habit:removed").total, 1);
  assert.equal(byId(sources, "challenge:ch").total, 2);
});

test("edits, deletions and repeated imports recalculate rather than accumulating rewards", () => {
  const state = sample();
  const original = JSON.stringify(state);
  assert.equal(collectMapSources(state, today)[0].total, 50);
  assert.equal(collectMapSources(JSON.parse(original), today)[0].total, 50);
  assert.equal(JSON.stringify(state), original);
  state.days[today].workouts[0].sets = [10];
  assert.equal(collectMapSources(state, today)[0].total, 40);
  delete state.days["2026-07-01"];
  assert.equal(collectMapSources(state, today)[0].total, 10);
});

test("invalid and negative repetitions cannot corrupt a map", () => {
  const state = { days: { [today]: { workouts: [{ name: "Тест", type: "reps", sets: ["15", -20, Infinity, NaN, "oops", null, {}, true, 3.9] }] } } };
  assert.equal(collectMapSources(state, today)[0].total, 18);
  assert.equal(collectMapSources({}, today)[0].total, 0);
});

test("page boundaries retain a finished image and carry overflow into the next one", () => {
  assert.deepEqual([mapProgress(0).page, mapProgress(0).filled], [0, 0]);
  assert.deepEqual([mapProgress(399).filled, mapProgress(399).percent], [399, 99]);
  assert.deepEqual([mapProgress(400).page, mapProgress(400).filled, mapProgress(400).completed], [0, 400, 1]);
  assert.deepEqual([mapProgress(415).page, mapProgress(415).filled], [1, 15]);
  assert.equal(mapProgress(415, 1, 0).filled, 400);
  assert.equal(mapProgress(415, 1, 999).page, 1);
  assert.deepEqual([mapProgress(400, 1, 1).page, mapProgress(400, 1, 1).filled], [1, 0]);
  assert.deepEqual([mapProgress(41, 10).page, mapProgress(41, 10).filled, mapProgress(41, 10).remaining], [1, 10, 39]);
  assert.equal(mapProgress(NaN).filled, 0);
  assert.equal(mapProgress(-100).filled, 0);
});

test("fill paths are deterministic, connected and visit all cells exactly once", () => {
  for (const seed of ["all-reps:0", "exercise:reps:турник:17", "habit:reading:1"]) {
    const order = mapRevealOrder(seed);
    assert.deepEqual(order, mapRevealOrder(seed));
    assert.equal(new Set(order).size, MAP_CELLS);
    const seen = new Set();
    for (const cell of order) {
      assert.ok(cell >= 0 && cell < MAP_CELLS);
      const x = cell % MAP_SIZE, y = Math.floor(cell / MAP_SIZE);
      if (seen.size) assert.ok([...seen].some((other) => Math.abs(other % MAP_SIZE - x) + Math.abs(Math.floor(other / MAP_SIZE) - y) === 1));
      seen.add(cell);
    }
  }
});

test("both the image and every hidden phrase supply a complete safe palette", () => {
  const names = new Set();
  for (const mode of ["picture", "text"]) {
    for (let page = 0; page < 5; page += 1) {
      const art = mapArtwork(mode, page);
      assert.equal(art.colors.length, MAP_CELLS);
      assert.ok(art.colors.every((color) => /^#[0-9a-f]{6}$/i.test(color)));
      if (mode === "text") names.add(art.name);
    }
  }
  assert.equal(names.size, 3);
});

// Exercise the actual renderer and its event callbacks with a small DOM adapter.
// Tests never read or modify the user's localStorage or synced training data.
function createHost() {
  let html = "";
  const nodes = new Map();
  const node = (key, dataset = {}) => {
    if (!nodes.has(key)) nodes.set(key, { dataset, handlers: {}, addEventListener(type, fn) { this.handlers[type] = fn; }, focus() {} });
    return nodes.get(key);
  };
  return {
    get innerHTML() { return html; },
    set innerHTML(value) { html = value; nodes.clear(); },
    querySelector(selector) { return node(selector); },
    querySelectorAll(selector) {
      return (selector === "[data-map-art]" ? ["picture", "text"] : ["prev", "next"]).map((value) =>
        node(`${selector}:${value}`, selector === "[data-map-art]" ? { mapArt: value } : { mapPage: value }));
    },
    changeSource(value) { node("#map-source").handlers.change({ target: { value } }); },
    clickArt(value) { node(`[data-map-art]:${value}`).handlers.click(); },
    clickPage(value) { node(`[data-map-page]:${value}`).handlers.click(); },
  };
}

test("renderer hides unearned art, supports source/mode/page controls and remembers selection", () => {
  const memory = new Map();
  const storage = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
  const renderer = createProgressMap(storage);
  const host = createHost();
  const state = sample();
  state.days[today].workouts[0].sets = [415];
  renderer.render(host, state, today);
  assert.match(host.innerHTML, /<span>Карта 2<\/span>/);
  assert.equal((host.innerHTML.match(/class="map-pixel revealed/g) || []).length, 45);
  assert.doesNotMatch(host.innerHTML, /Путь к вершине/);
  host.clickPage("prev");
  assert.equal((host.innerHTML.match(/class="map-pixel revealed/g) || []).length, 400);
  assert.match(host.innerHTML, /Открыто: Путь к вершине/);
  host.clickArt("text");
  assert.match(host.innerHTML, /Открыто: ТЫ СМОГ/);
  host.changeSource("exercise:reps:турник");
  assert.equal((host.innerHTML.match(/class="map-pixel revealed/g) || []).length, 5);
  const restoredHost = createHost();
  createProgressMap(storage).render(restoredHost, state, today);
  assert.match(restoredHost.innerHTML, /value="exercise:reps:турник" selected/);
  assert.match(restoredHost.innerHTML, /data-map-art="text" aria-pressed="true"/);
});

test("missing preferences, storage failures and HTML in user names cannot break the card", () => {
  const renderer = createProgressMap({ getItem() { throw new Error("blocked"); }, setItem() { throw new Error("full"); } });
  const host = createHost();
  const state = { exercises: [{ name: '<img src=x onerror=alert(1)>', type: "reps" }] };
  renderer.render(host, state, today);
  assert.doesNotMatch(host.innerHTML, /<img/);
  assert.match(host.innerHTML, /&lt;img/);
  assert.match(host.innerHTML, /Запиши первое выполнение/);
  host.clickArt("text");
  assert.match(host.innerHTML, /data-map-art="text" aria-pressed="true"/);
});

test("animation only marks new progress, never opening the map or changing its artwork", () => {
  const renderer = createProgressMap({ getItem: () => null, setItem() {} });
  const host = createHost();
  const state = sample();
  renderer.render(host, state, today);
  assert.doesNotMatch(host.innerHTML, /revealed fresh/);
  assert.match(host.innerHTML, /map-mosaic map-picture/);
  assert.match(host.innerHTML, /--tile-x:/);
  state.days[today].workouts[0].sets.push(15);
  renderer.render(host, state, today);
  assert.equal((host.innerHTML.match(/revealed fresh/g) || []).length, 15);
  renderer.render(host, state, today);
  assert.doesNotMatch(host.innerHTML, /revealed fresh/);
  host.clickArt("text");
  assert.doesNotMatch(host.innerHTML, /revealed fresh/);
  assert.match(host.innerHTML, /map-mosaic map-text/);
});
