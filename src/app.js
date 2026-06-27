import { createStore } from "./storage.js";
import * as L from "./logic.js";
import * as Charts from "./charts.js";
import * as Sync from "./sync.js";

const store = createStore(window.localStorage);

let syncCfg = Sync.loadSyncConfig(window.localStorage);
let syncStatus = "idle"; // idle | syncing | ok | offline
const APP_VERSION = "20260627-5";
let todayRoute = "main"; // main | workouts | nutrition
let statsRange = "week"; // week | month

const MEALS = [
  { key: "breakfast", name: "Завтрак" },
  { key: "lunch", name: "Обед" },
  { key: "dinner", name: "Ужин" },
  { key: "snack", name: "Перекус" },
];
let addingMeal = null; // ключ приёма с открытой панелью добавления
let selectedFood = null; // выбранный из поиска продукт { id, name, per100g }
let manualOpen = false;

// Локальная запись + отложенная отправка на сервер.
function saveState(state) {
  store.set(state);
  schedulePush();
}

function syncStatusLabel() {
  return (
    {
      idle: "не настроено",
      syncing: "синхронизация…",
      ok: "синхронизировано",
      offline: "нет сети",
    }[syncStatus] || ""
  );
}
function setSyncStatus(s) {
  syncStatus = s;
  const el = document.getElementById("sync-status");
  if (el) el.textContent = syncStatusLabel();
}

async function pullOnStart() {
  if (!Sync.isConfigured(syncCfg)) {
    setSyncStatus("idle");
    return;
  }
  setSyncStatus("syncing");
  try {
    const client = Sync.createSyncClient(syncCfg, window.fetch.bind(window));
    const remote = await client.pull();
    const localUpdatedAt = store.getMeta().updatedAt;
    if (remote.state && Sync.chooseNewer(localUpdatedAt, remote.updatedAt) === "remote") {
      store.applyRemote(remote.state, remote.updatedAt);
    } else {
      await pushNow(); // на сервере пусто/старее — заливаем локальное
    }
    setSyncStatus("ok");
    show("today");
  } catch {
    setSyncStatus("offline");
  }
}

let pushTimer = null;
function schedulePush() {
  if (!Sync.isConfigured(syncCfg)) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushNow, 800);
}
async function pushNow() {
  if (!Sync.isConfigured(syncCfg)) return;
  setSyncStatus("syncing");
  try {
    const client = Sync.createSyncClient(syncCfg, window.fetch.bind(window));
    const { updatedAt } = await client.push(store.get(), store.getMeta().updatedAt);
    store.applyRemote(store.get(), updatedAt); // выровнять локальный updatedAt по серверному
    setSyncStatus("ok");
  } catch {
    setSyncStatus("offline");
  }
}

const screens = {
  today: document.getElementById("screen-today"),
  stats: document.getElementById("screen-stats"),
  settings: document.getElementById("screen-settings"),
};

// ---------- Иконки (inline SVG, без эмодзи) ----------
const ICON = {
  chevL: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>`,
  chevR: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>`,
  flame: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c1 3-2 4-2 7a2 2 0 104 0c0-1 0-1 .5-2 1.5 2 3.5 4 3.5 7a6 6 0 11-12 0c0-4 4-5 6-12z"/></svg>`,
  x: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M7 6l1 14h8l1-14"/></svg>`,
};

// ---------- Даты ----------
function todayISO() {
  return L.toISO(new Date());
}
let currentDay = todayISO();

const MONTHS = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
const MONTHS_SHORT = ["янв","фев","мар","апр","май","июн","июл","авг","сен","окт","ноя","дек"];
const WEEKDAYS = ["воскресенье","понедельник","вторник","среда","четверг","пятница","суббота"];

function dayMonth(iso) {
  const d = L.parseISO(iso);
  return d.getDate() + " " + MONTHS[d.getMonth()];
}
function shortDate(iso) {
  const d = L.parseISO(iso);
  return d.getDate() + " " + MONTHS_SHORT[d.getMonth()] + " " + d.getFullYear();
}
function weekday(iso) {
  const w = WEEKDAYS[L.parseISO(iso).getDay()];
  return w.charAt(0).toUpperCase() + w.slice(1);
}

function challengePhotoIndex(date = new Date()) {
  return Math.floor(date.getHours() / 6);
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pluralRu(n, one, few, many) {
  const v = Math.abs(Number(n)) % 100;
  const last = v % 10;
  if (v > 10 && v < 20) return many;
  if (last > 1 && last < 5) return few;
  return last === 1 ? one : many;
}

function getDay(state, iso) {
  if (!state.days[iso]) state.days[iso] = { workouts: [], habits: {}, note: "" };
  return state.days[iso];
}

// ---------- Навигация по вкладкам ----------
function show(tab) {
  for (const [name, el] of Object.entries(screens))
    el.classList.toggle("hidden", name !== tab);
  document
    .querySelectorAll(".tab")
    .forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  if (tab === "today") renderToday();
  if (tab === "stats") renderStats();
  if (tab === "settings") renderSettings();
}

document
  .querySelectorAll(".tab")
  .forEach((t) => t.addEventListener("click", () => {
    if (t.dataset.tab === "today") {
      todayRoute = "main";
      addingMeal = null;
      selectedFood = null;
      manualOpen = false;
    }
    show(t.dataset.tab);
  }));

// ---------- Экран «Сегодня» ----------
function renderToday() {
  if (todayRoute === "workouts") {
    renderWorkoutDetailScreen();
    return;
  }
  if (todayRoute === "nutrition") {
    renderNutritionDetailScreen();
    return;
  }

  // возврат на главный экран закрывает временные панели
  addingMeal = null;
  selectedFood = null;
  manualOpen = false;
  const s = store.get();
  const today = todayISO();

  let big, sub;
  if (currentDay === today) { big = "Сегодня"; sub = weekday(currentDay) + ", " + dayMonth(currentDay); }
  else if (currentDay === L.addDays(today, -1)) { big = "Вчера"; sub = weekday(currentDay) + ", " + dayMonth(currentDay); }
  else if (currentDay === L.addDays(today, 1)) { big = "Завтра"; sub = weekday(currentDay) + ", " + dayMonth(currentDay); }
  else { big = dayMonth(currentDay); sub = weekday(currentDay); }

  const ch = s.settings.challenge;
  const rem = L.challengeRemaining(ch, today);
  const dayNo = L.challengeDayNumber(ch, today);
  const challengePhoto = challengePhotoIndex();
  const challengeProgress = Math.round(Math.min(1, Math.max(0, dayNo / 75)) * 360);
  const noAlco = L.daysSince(s.settings.noAlcoholStart, today);
  const noSpray = L.daysSince(s.settings.noSpraysStart, today);

  const w = s.settings.weighIn;
  const isWeigh = L.isWeighInDay(w, today);
  const nextW = L.nextWeighInDate(w, today);
  const lastW = L.lastWeighInValue(s.weighIns, today);

  screens.today.innerHTML = `
    <div class="day-nav">
      <button class="navbtn" id="day-prev" aria-label="Назад">${ICON.chevL}</button>
      <div class="label"><div class="big">${big}</div><div class="sub">${sub}</div></div>
      <button class="navbtn" id="day-next" aria-label="Вперёд">${ICON.chevR}</button>
    </div>

    <div class="counters">
      <div class="counter hero challenge-photo-${challengePhoto}" style="--challenge-progress: ${challengeProgress}deg">
        <div class="c-label">Челлендж</div>
        <div class="c-row"><div class="c-big">${rem}</div><div class="c-pill">День ${dayNo} / 75</div></div>
        <div class="c-sub">осталось дней</div>
      </div>
      <div class="counter alco">
        <div class="c-label">Без алкоголя</div>
        <div class="c-big">${noAlco}</div>
        <div class="c-sub">дней · с ${shortDate(s.settings.noAlcoholStart)}</div>
      </div>
      <div class="counter spray">
        <div class="c-label">Без спреев</div>
        <div class="c-big">${noSpray}</div>
        <div class="c-sub">дней · с ${shortDate(s.settings.noSpraysStart)}</div>
      </div>
    </div>

    <div class="card">
      <div class="weigh-head">
        <div>
          <div class="eyebrow">Взвешивание</div>
          <div class="weigh-val">${lastW != null ? lastW + `<span class="unit">кг</span>` : "—"}</div>
          <div class="weigh-sub">${isWeigh ? "Пора взвеситься" : "Следующее: " + dayMonth(nextW)}</div>
        </div>
        ${isWeigh ? `<span class="badge-due">Сегодня</span>` : ""}
      </div>
      ${isWeigh ? `<div class="weigh-input">
        <input id="weigh-val" type="number" step="0.1" inputmode="decimal" placeholder="кг" />
        <button class="btn blue" id="weigh-save">Записать</button></div>` : ""}
    </div>

    <div id="today-workouts"></div>
    <div id="today-nutrition"></div>
    <div id="today-habits"></div>
    <div id="today-note"></div>
  `;

  document.getElementById("day-prev").addEventListener("click", () => {
    currentDay = L.addDays(currentDay, -1);
    todayRoute = "main";
    renderToday();
  });
  document.getElementById("day-next").addEventListener("click", () => {
    currentDay = L.addDays(currentDay, 1);
    todayRoute = "main";
    renderToday();
  });

  if (isWeigh) {
    document.getElementById("weigh-save").addEventListener("click", () => {
      const val = parseFloat(document.getElementById("weigh-val").value);
      if (!isFinite(val)) return;
      const st = store.get();
      st.weighIns = st.weighIns.filter((x) => x.date !== today);
      st.weighIns.push({ date: today, weight: val });
      saveState(st);
      renderToday();
    });
  }

  renderWorkouts();
  renderNutrition();
  renderHabits();
  renderNote();
}

function renderDetailShell({ title, sub, accent, bodyId }) {
  screens.today.innerHTML = `
    <div class="detail-top">
      <button class="navbtn detail-back" id="detail-back" aria-label="Назад">${ICON.chevL}</button>
      <div>
        <div class="detail-kicker">${esc(sub)}</div>
        <h1>${esc(title)}</h1>
      </div>
    </div>
    <div class="detail-accent ${accent || ""}"></div>
    <div id="${bodyId}"></div>
  `;
  document.getElementById("detail-back").addEventListener("click", () => {
    todayRoute = "main";
    addingMeal = null;
    selectedFood = null;
    manualOpen = false;
    renderToday();
  });
}

function ensureNutrition(day) {
  if (!day.nutrition || !day.nutrition.meals) {
    day.nutrition = { meals: { breakfast: [], lunch: [], dinner: [], snack: [] } };
  }
  return day.nutrition;
}

function apiBase() {
  return (syncCfg.apiUrl || "").replace(/\/$/, "");
}
async function foodSearch(q) {
  const r = await window.fetch(`${apiBase()}/foods/search?q=${encodeURIComponent(q)}`, {
    headers: { Authorization: `Bearer ${syncCfg.token}` },
  });
  if (!r.ok) throw new Error("поиск " + r.status);
  return (await r.json()).foods || [];
}
async function foodGet(id) {
  const r = await window.fetch(`${apiBase()}/foods/get?id=${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${syncCfg.token}` },
  });
  if (!r.ok) throw new Error("деталь " + r.status);
  return (await r.json()).food;
}

function renderNutrition() {
  const s = store.get();
  const day = getDay(s, currentDay);
  ensureNutrition(day);
  const totals = L.dayNutritionTotals(day);
  const mealSummary = MEALS.map((m) => {
    const entries = day.nutrition.meals[m.key] || [];
    const kcal = entries.reduce((a, e) => a + (e.kcal || 0), 0);
    return { ...m, count: entries.length, kcal };
  });
  const summaryRows = mealSummary
    .filter((m) => m.count || m.kcal)
    .map(
      (m) => `<div class="summary-row">
        <span>${m.name}</span>
        <b>${m.kcal} ккал · ${m.count} ${pluralRu(m.count, "продукт", "продукта", "продуктов")}</b>
      </div>`
    )
    .join("");

  document.getElementById("today-nutrition").innerHTML = `
    <button class="card module-card nutrition-card route-card" data-open-nutrition>
      <div class="module-head">
        <div>
          <div class="eyebrow">Питание</div>
          <div class="module-title">${totals.kcal} ккал</div>
        </div>
      </div>
      <div class="macro-grid">
        <div><span>Белки</span><b>${totals.p}</b></div>
        <div><span>Жиры</span><b>${totals.f}</b></div>
        <div><span>Углеводы</span><b>${totals.c}</b></div>
      </div>
      <div class="summary-list">
        ${summaryRows || `<div class="empty-hint">Еда ещё не добавлена.</div>`}
      </div>
    </button>`;

  document.querySelector("[data-open-nutrition]").addEventListener("click", () => {
    todayRoute = "nutrition";
    renderToday();
  });
}

function renderNutritionDetailScreen() {
  renderDetailShell({ title: "Питание", sub: `${weekday(currentDay)}, ${dayMonth(currentDay)}`, accent: "nutrition", bodyId: "nutrition-detail" });
  renderNutritionDetail();
}

function renderNutritionDetail() {
  const s = store.get();
  const day = getDay(s, currentDay);
  ensureNutrition(day);
  const totals = L.dayNutritionTotals(day);
  const mealsHtml = MEALS.map((m) => {
    const entries = day.nutrition.meals[m.key] || [];
    const sub = entries.reduce((a, e) => a + (e.kcal || 0), 0);
    const rows = entries
      .map(
        (e, i) => `<div class="food-entry">
          <div class="fe-main"><span class="fe-name">${esc(e.name)}</span><span class="fe-sub">${e.grams ? e.grams + " г · " : ""}${e.kcal} ккал</span></div>
          <button class="x" data-del-food="${m.key}:${i}">${ICON.x}</button></div>`
      )
      .join("");
    return `<div class="meal detail-panel">
      <div class="meal-head"><span class="meal-name">${m.name}</span><span class="meal-sub">${sub} ккал</span></div>
      ${rows || `<div class="empty-hint">Пока пусто.</div>`}
      ${addingMeal === m.key ? addPanelHtml() : `<button class="add-food" data-add-meal="${m.key}">＋ добавить</button>`}
    </div>`;
  }).join("");

  document.getElementById("nutrition-detail").innerHTML = `
    <div class="detail-hero nutrition">
      <div><span>Калории</span><b>${totals.kcal}</b></div>
      <div><span>Белки</span><b>${totals.p}</b></div>
      <div><span>Жиры</span><b>${totals.f}</b></div>
      <div><span>Углеводы</span><b>${totals.c}</b></div>
    </div>
    ${mealsHtml}
  `;

  wireNutrition();
}

function addPanelHtml() {
  const configured = Sync.isConfigured(syncCfg);
  return `<div class="nutri-add">
    ${
      configured
        ? `<input id="n-search" placeholder="найти продукт (банан, овсянка…)" autocomplete="off" />
           <div id="n-results"></div><div id="n-selected"></div>`
        : `<div class="empty-hint">Поиск продуктов включится после настройки синхронизации.</div>`
    }
    <button class="link-btn" id="n-manual-toggle">${manualOpen ? "скрыть ручной ввод" : "или ввести вручную"}</button>
    ${
      manualOpen
        ? `<div class="manual-add">
            <input id="nm-name" placeholder="название" autocomplete="off" />
            <div class="nutri-macros">
              <label>Ккал<input id="nm-kcal" type="number" inputmode="numeric"/></label>
              <label>Б<input id="nm-p" type="number" inputmode="decimal"/></label>
              <label>Ж<input id="nm-f" type="number" inputmode="decimal"/></label>
              <label>У<input id="nm-c" type="number" inputmode="decimal"/></label>
            </div>
            <button class="btn" id="nm-add">Добавить</button></div>`
        : ""
    }
    <button class="link-btn close" id="n-close">закрыть</button>
  </div>`;
}

function wireNutrition() {
  document.querySelectorAll("[data-add-meal]").forEach((b) =>
    b.addEventListener("click", () => {
      addingMeal = b.dataset.addMeal;
      selectedFood = null;
      manualOpen = false;
      renderNutritionDetail();
    })
  );
  document.querySelectorAll("[data-del-food]").forEach((b) =>
    b.addEventListener("click", () => {
      const [mealKey, idx] = b.dataset.delFood.split(":");
      const st = store.get();
      const d = getDay(st, currentDay);
      ensureNutrition(d);
      d.nutrition.meals[mealKey].splice(+idx, 1);
      saveState(st);
      renderNutritionDetail();
    })
  );
  if (addingMeal) wireAddPanel();
}

function wireAddPanel() {
  const close = document.getElementById("n-close");
  if (close)
    close.addEventListener("click", () => {
      addingMeal = null;
      selectedFood = null;
      manualOpen = false;
      renderNutritionDetail();
    });

  const mt = document.getElementById("n-manual-toggle");
  if (mt)
    mt.addEventListener("click", () => {
      manualOpen = !manualOpen;
      renderNutritionDetail();
    });

  const ma = document.getElementById("nm-add");
  if (ma)
    ma.addEventListener("click", () => {
      const name = document.getElementById("nm-name").value.trim();
      const kcal = parseInt(document.getElementById("nm-kcal").value, 10) || 0;
      if (!name || !kcal) return;
      addEntry(addingMeal, {
        name,
        grams: 0,
        kcal,
        p: parseFloat(document.getElementById("nm-p").value) || 0,
        f: parseFloat(document.getElementById("nm-f").value) || 0,
        c: parseFloat(document.getElementById("nm-c").value) || 0,
      });
    });

  const search = document.getElementById("n-search");
  if (search) {
    let timer = null;
    search.addEventListener("input", () => {
      clearTimeout(timer);
      const q = search.value.trim();
      if (q.length < 2) {
        const box = document.getElementById("n-results");
        if (box) box.innerHTML = "";
        return;
      }
      timer = setTimeout(() => runFoodSearch(q), 400);
    });
    search.focus();
  }
}

function parseKcalFromDesc(desc) {
  const m = /Calories:\s*([\d.]+)\s*kcal/i.exec(desc || "");
  return m ? Math.round(parseFloat(m[1])) + " ккал/100г" : "";
}

async function runFoodSearch(q) {
  const box = document.getElementById("n-results");
  if (!box) return;
  box.innerHTML = `<div class="searching">ищу…</div>`;
  try {
    const foods = await foodSearch(q);
    const cur = document.getElementById("n-results");
    if (!cur) return;
    cur.innerHTML =
      foods
        .slice(0, 12)
        .map(
          (f) => `<button class="food-row" data-fid="${esc(f.id)}" data-fname="${esc(f.name)}">
            <span class="fr-name">${esc(f.name)}${f.brand ? " · " + esc(f.brand) : ""}</span>
            <span class="fr-kcal">${parseKcalFromDesc(f.desc)}</span></button>`
        )
        .join("") || `<div class="searching">ничего не нашлось</div>`;
    cur.querySelectorAll(".food-row").forEach((row) =>
      row.addEventListener("click", () => selectFood(row.dataset.fid, row.dataset.fname))
    );
  } catch (e) {
    const cur = document.getElementById("n-results");
    if (cur) cur.innerHTML = `<div class="searching err">ошибка поиска (${esc(e.message)})</div>`;
  }
}

async function selectFood(id, name) {
  const results = document.getElementById("n-results");
  const search = document.getElementById("n-search");
  if (results) results.innerHTML = "";
  if (search) search.value = name;
  const sel = document.getElementById("n-selected");
  if (sel) sel.innerHTML = `<div class="searching">загружаю «${esc(name)}»…</div>`;
  try {
    const food = await foodGet(id);
    const cur = document.getElementById("n-selected");
    if (!cur) return;
    if (!food.per100g) {
      cur.innerHTML = `<div class="searching err">нет данных в граммах — добавь вручную</div>`;
      selectedFood = null;
      return;
    }
    selectedFood = { id: food.id, name: food.name, per100g: food.per100g };
    renderSelected();
  } catch (e) {
    const cur = document.getElementById("n-selected");
    if (cur) cur.innerHTML = `<div class="searching err">ошибка (${esc(e.message)})</div>`;
  }
}

function renderSelected() {
  const sel = document.getElementById("n-selected");
  if (!sel || !selectedFood) return;
  const p = selectedFood.per100g;
  sel.innerHTML = `<div class="selected-food">
    <div class="sf-main">
      <div class="sf-name">${esc(selectedFood.name)}</div>
      <div class="sf-per">${p.kcal} ккал/100г · Б ${p.p} Ж ${p.f} У ${p.c}</div>
    </div>
    <div class="sf-add"><input id="sf-grams" type="number" inputmode="numeric" placeholder="г" value="100" aria-label="Граммы" />
      <button class="btn" id="sf-add-btn">Добавить</button></div></div>`;
  document.getElementById("sf-add-btn").addEventListener("click", () => {
    const g = parseInt(document.getElementById("sf-grams").value, 10) || 0;
    if (!g) return;
    const k = g / 100;
    addEntry(addingMeal, {
      name: selectedFood.name,
      grams: g,
      kcal: Math.round(p.kcal * k),
      p: Math.round(p.p * k * 10) / 10,
      f: Math.round(p.f * k * 10) / 10,
      c: Math.round(p.c * k * 10) / 10,
    });
  });
  document.getElementById("sf-grams").focus();
}

function addEntry(mealKey, entry) {
  const st = store.get();
  const d = getDay(st, currentDay);
  ensureNutrition(d);
  d.nutrition.meals[mealKey].push(entry);
  saveState(st);
  addingMeal = null;
  selectedFood = null;
  manualOpen = false;
  renderNutritionDetail();
}

function sumSets(sets) {
  return (sets || []).reduce((a, b) => a + b, 0);
}

function renderWorkouts() {
  const s = store.get();
  const day = getDay(s, currentDay);
  const workouts = day.workouts || [];
  const workoutRows = workouts
    .map((wk) => {
      if (wk.type === "cardio") {
        const value = (wk.value || "").trim();
        return `<div class="summary-row"><span>${esc(wk.name)}</span><b>${value || "кардио"}</b></div>`;
      }
      const sets = wk.sets || [];
      const total = sumSets(sets);
      return `<div class="summary-row">
        <span>${esc(wk.name)}</span>
        <b>${sets.length} ${pluralRu(sets.length, "подход", "подхода", "подходов")} · ${total} ${pluralRu(total, "повторение", "повторения", "повторений")}</b>
      </div>`;
    })
    .join("");
  const workoutTotal = workouts.reduce((a, wk) => a + (wk.type === "reps" ? sumSets(wk.sets) : 0), 0);

  document.getElementById("today-workouts").innerHTML = `
    <button class="card module-card workout-card route-card" data-open-workouts>
      <div class="module-head">
        <div>
          <div class="eyebrow">Тренировка</div>
          <div class="module-title">${workouts.length ? `${workouts.length} ${pluralRu(workouts.length, "упражнение", "упражнения", "упражнений")}` : "Нет записи"}</div>
        </div>
      </div>
      <div class="summary-metric">
        <span>Повторы за день</span>
        <b>${workoutTotal}</b>
      </div>
      <div class="summary-list">
        ${workoutRows || `<div class="empty-hint">Добавь упражнение в подробностях.</div>`}
      </div>
    </button>`;

  document.querySelector("[data-open-workouts]").addEventListener("click", () => {
    todayRoute = "workouts";
    renderToday();
  });
}

function renderWorkoutDetailScreen() {
  renderDetailShell({ title: "Тренировка", sub: `${weekday(currentDay)}, ${dayMonth(currentDay)}`, accent: "workout", bodyId: "workout-detail" });
  renderWorkoutDetail();
}

function renderWorkoutDetail() {
  const s = store.get();
  const day = getDay(s, currentDay);
  const workouts = day.workouts || [];
  const workoutTotal = workouts.reduce((a, wk) => a + (wk.type === "reps" ? sumSets(wk.sets) : 0), 0);
  const chips =
    s.exercises
      .map((e) => `<button class="chip" data-add-ex="${esc(e.id)}">${esc(e.name)}</button>`)
      .join("") + `<button class="chip add" id="add-custom">${ICON.plus} своё</button>`;

  const blocks = workouts
    .map((wk, i) => {
      if (wk.type === "cardio") {
        return `<div class="ex-block">
          <div class="ex-head"><span class="ex-name">${esc(wk.name)}</span>
            <button class="ex-del" data-del-wk="${i}">${ICON.x}</button></div>
          <input class="cardio-input" data-wk="${i}" value="${esc(wk.value || "")}" placeholder="5 км / 30 мин" />
        </div>`;
      }
      const rows = (wk.sets || [])
        .map(
          (r, si) => `<div class="set-swipe" data-swipe-row>
            <button class="set-delete" data-delset-wk="${i}" data-delset="${si}">${ICON.trash}<span>Удалить</span></button>
            <div class="set-row" data-swipe-content>
              <span class="set-idx">Подход ${si + 1}</span>
              <div class="rep-control">
                <button class="step minus" data-wk="${i}" data-set="${si}" data-d="-1">−</button>
                <input class="reps-input" id="val-${i}-${si}" data-wk="${i}" data-set="${si}" type="number" inputmode="numeric" min="0" value="${r}" aria-label="Повторы в подходе ${si + 1}" />
                <button class="step plus" data-wk="${i}" data-set="${si}" data-d="1">+</button>
              </div>
            </div></div>`
        )
        .join("");
      return `<div class="ex-block">
        <div class="ex-head"><span class="ex-name">${esc(wk.name)}</span>
          <button class="ex-del" data-del-wk="${i}">${ICON.x}</button></div>
        <label class="exercise-weight">Вес, кг
          <input class="exercise-weight-input" data-weight-wk="${i}" type="number" step="0.5" inputmode="decimal" placeholder="необязательно" value="${wk.weight != null ? esc(wk.weight) : ""}" />
        </label>
        <div class="set-rows">${rows}</div>
        <button class="add-set" data-addset="${i}">Добавить подход</button>
        <div class="ex-total">Всего: <b id="total-${i}">${sumSets(wk.sets)}</b></div>
      </div>`;
    })
    .join("");

  document.getElementById("workout-detail").innerHTML = `
    <div class="detail-hero workout">
      <div><span>Упражнения</span><b>${workouts.length}</b></div>
      <div><span>Повторы</span><b>${workoutTotal}</b></div>
    </div>
    <div class="detail-panel">
      <div class="chips">${chips}</div>
    </div>
    ${blocks || `<div class="detail-panel"><div class="empty-hint">Нажми упражнение выше, чтобы записать подходы.</div></div>`}
  `;

  wireWorkoutEvents();
}

function wireWorkoutEvents() {
  document.querySelectorAll("[data-add-ex]").forEach((b) =>
    b.addEventListener("click", () => {
      const s = store.get();
      const ex = s.exercises.find((e) => e.id === b.dataset.addEx);
      const day = getDay(s, currentDay);
      day.workouts.push(
        ex.type === "cardio"
          ? { exerciseId: ex.id, name: ex.name, type: "cardio", value: "" }
          : { exerciseId: ex.id, name: ex.name, type: "reps", sets: [0] }
      );
      saveState(s);
      renderWorkoutDetail();
    })
  );

  document.getElementById("add-custom").addEventListener("click", () => {
    const name = prompt("Название упражнения?");
    if (!name) return;
    const isCardio = confirm("Это кардио (бег и т.п.)?  OK — да,  Отмена — подходы.");
    let weight = null;
    if (!isCardio) {
      const rawWeight = prompt("Вес, кг? Можно оставить пустым.");
      if (rawWeight != null && rawWeight.trim() !== "") {
        const parsedWeight = parseFloat(rawWeight.replace(",", "."));
        if (isFinite(parsedWeight)) weight = parsedWeight;
      }
    }
    const s = store.get();
    const day = getDay(s, currentDay);
    day.workouts.push(
      isCardio ? { name, type: "cardio", value: "" } : { name, type: "reps", sets: [0], ...(weight != null ? { weight } : {}) }
    );
    saveState(s);
    renderWorkoutDetail();
  });

  // степпер — обновление на месте, без перерисовки
  document.querySelectorAll(".step").forEach((b) =>
    b.addEventListener("click", () => {
      const wk = +b.dataset.wk, si = +b.dataset.set, d = +b.dataset.d;
      const s = store.get();
      const day = getDay(s, currentDay);
      let v = (day.workouts[wk].sets[si] || 0) + d;
      if (v < 0) v = 0;
      day.workouts[wk].sets[si] = v;
      saveState(s);
      renderWorkoutDetail();
    })
  );

  document.querySelectorAll(".reps-input").forEach((inp) => {
    inp.addEventListener("focus", () => inp.select());
    inp.addEventListener("change", () => {
      const wk = +inp.dataset.wk, si = +inp.dataset.set;
      const s = store.get();
      const day = getDay(s, currentDay);
      const v = Math.max(0, parseInt(inp.value, 10) || 0);
      day.workouts[wk].sets[si] = v;
      inp.value = v;
      saveState(s);
      renderWorkoutDetail();
    });
  });

  document.querySelectorAll("[data-addset]").forEach((b) =>
    b.addEventListener("click", () => {
      const s = store.get();
      const sets = getDay(s, currentDay).workouts[+b.dataset.addset].sets;
      sets.push(sets.length ? sets[sets.length - 1] : 0); // копируем прошлый подход
      saveState(s);
      renderWorkoutDetail();
    })
  );

  document.querySelectorAll("input.cardio-input").forEach((inp) =>
    inp.addEventListener("change", () => {
      const s = store.get();
      getDay(s, currentDay).workouts[+inp.dataset.wk].value = inp.value;
      saveState(s);
    })
  );

  document.querySelectorAll("input.exercise-weight-input").forEach((inp) =>
    inp.addEventListener("change", () => {
      const s = store.get();
      const workout = getDay(s, currentDay).workouts[+inp.dataset.weightWk];
      const raw = inp.value.trim().replace(",", ".");
      if (!raw) delete workout.weight;
      else {
        const weight = parseFloat(raw);
        if (!isFinite(weight)) return;
        workout.weight = weight;
        inp.value = weight;
      }
      saveState(s);
    })
  );

  document.querySelectorAll("[data-del-wk]").forEach((b) =>
    b.addEventListener("click", () => {
      const s = store.get();
      const wk = getDay(s, currentDay).workouts[+b.dataset.delWk];
      const name = wk ? wk.name : "упражнение";
      if (!confirm(`Удалить «${name}» из тренировки?`)) return;
      getDay(s, currentDay).workouts.splice(+b.dataset.delWk, 1);
      saveState(s);
      renderWorkoutDetail();
    })
  );

  document.querySelectorAll("[data-delset]").forEach((b) =>
    b.addEventListener("click", () => {
      const s = store.get();
      const workout = getDay(s, currentDay).workouts[+b.dataset.delsetWk];
      if (!workout || !workout.sets) return;
      workout.sets.splice(+b.dataset.delset, 1);
      if (!workout.sets.length) workout.sets.push(0);
      saveState(s);
      renderWorkoutDetail();
    })
  );

  wireSetSwipe();
}

function wireSetSwipe() {
  document.querySelectorAll("[data-swipe-row]").forEach((row) => {
    const content = row.querySelector("[data-swipe-content]");
    let startX = 0, startY = 0, dx = 0, dragging = false;
    const close = () => {
      row.classList.remove("open");
      content.style.transform = "";
    };
    content.addEventListener("touchstart", (e) => {
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      dx = 0;
      dragging = true;
    }, { passive: true });
    content.addEventListener("touchmove", (e) => {
      if (!dragging) return;
      const t = e.touches[0];
      dx = t.clientX - startX;
      const dy = Math.abs(t.clientY - startY);
      if (dy > Math.abs(dx)) return;
      const x = Math.max(-92, Math.min(0, dx));
      content.style.transform = `translateX(${x}px)`;
    }, { passive: true });
    content.addEventListener("touchend", () => {
      dragging = false;
      if (dx < -44) row.classList.add("open");
      else close();
      content.style.transform = "";
    });
  });
}

function renderHabits() {
  const s = store.get();
  const day = getDay(s, currentDay);
  const items = s.habits
    .map((h) => {
      const done = !!(day.habits && day.habits[h.id]);
      const streak = L.habitStreak(s.days, h.id, currentDay);
      return `<button class="habit ${done ? "done" : ""}" data-habit="${esc(h.id)}">
        <span class="check">${ICON.check}</span>
        <span class="h-name">${esc(h.name)}</span>
        <span class="streak ${streak > 0 ? "" : "hidden-streak"}" id="streak-${esc(h.id)}">${ICON.flame}${streak}</span>
      </button>`;
    })
    .join("");
  document.getElementById("today-habits").innerHTML = `
    <div class="card">
      <div class="section-head"><div class="title">Привычки</div></div>
      ${items}
    </div>`;

  const today = todayISO();
  document.querySelectorAll("[data-habit]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const id = btn.dataset.habit;
      const st = store.get();
      const d = getDay(st, currentDay);
      d.habits[id] = !d.habits[id];
      saveState(st);
      // обновление на месте
      btn.classList.toggle("done", !!d.habits[id]);
      const streak = L.habitStreak(st.days, id, currentDay);
      const pill = document.getElementById("streak-" + id);
      pill.classList.toggle("hidden-streak", streak <= 0);
      pill.innerHTML = ICON.flame + streak;
      if (currentDay === today && st.habits.length && st.habits.every((h) => d.habits[h.id]))
        celebrate();
    })
  );
}

function renderNote() {
  const s = store.get();
  const day = getDay(s, currentDay);
  document.getElementById("today-note").innerHTML = `
    <div class="card">
      <div class="section-head"><div class="title">Заметка</div></div>
      <textarea id="note-area" rows="3" placeholder="как прошёл день…">${esc(day.note || "")}</textarea>
    </div>`;
  document.getElementById("note-area").addEventListener("change", (e) => {
    const st = store.get();
    getDay(st, currentDay).note = e.target.value;
    saveState(st);
  });
}

function celebrate() {
  const layer = document.createElement("div");
  layer.className = "confetti";
  const colors = ["#58cc02", "#1cb0f6", "#ff9a00", "#a560f0", "#ff4b4b"];
  for (let i = 0; i < 36; i++) {
    const p = document.createElement("i");
    p.style.left = (i / 36) * 100 + "%";
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = (i % 12) * 0.04 + "s";
    layer.appendChild(p);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 1700);
}

// ---------- Экран «Статистика» ----------
function rangeDays(endISO, count) {
  const days = [];
  for (let i = count - 1; i >= 0; i--) days.push(L.addDays(endISO, -i));
  return days;
}

function chartDayLabel(iso, range) {
  const d = L.parseISO(iso);
  if (range === "week") return ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"][d.getDay()];
  return String(d.getDate());
}

function workoutCountInRange(days, dates) {
  return dates.filter((iso) => days[iso] && (days[iso].workouts || []).length > 0).length;
}

function exercisePoints(days, exerciseName, dates) {
  return dates.map((date) => {
    const workouts = ((days[date] && days[date].workouts) || []).filter(
      (w) => w.type === "reps" && w.name === exerciseName
    );
    const value = workouts.reduce((a, w) => a + sumSets(w.sets), 0);
    const sets = workouts.reduce((a, w) => a + ((w.sets && w.sets.length) || 0), 0);
    const weighted = [...workouts].reverse().find((w) => w.weight != null && isFinite(Number(w.weight)));
    return {
      date,
      label: chartDayLabel(date, statsRange),
      value,
      sets,
      weight: weighted ? Math.round(Number(weighted.weight) * 10) / 10 : null,
    };
  });
}

function exerciseNamesInState(days) {
  return [
    ...new Set(
      Object.values(days).flatMap((d) =>
        (d.workouts || []).filter((w) => w.type === "reps").map((w) => w.name)
      )
    ),
  ];
}

function percentDelta(current, previous) {
  if (!previous && !current) return 0;
  if (!previous) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function statTile(label, value, sub = "") {
  return `<div class="stat-tile"><span>${label}</span><b>${value}</b>${sub ? `<em>${sub}</em>` : ""}</div>`;
}

function renderStats() {
  const s = store.get();
  const count = statsRange === "week" ? 7 : 30;
  const today = todayISO();
  const dates = rangeDays(today, count);
  const previousDates = rangeDays(L.addDays(dates[0], -1), count);
  const totalWorkouts = workoutCountInRange(s.days, dates);
  const previousWorkouts = workoutCountInRange(s.days, previousDates);
  const workoutDelta = totalWorkouts - previousWorkouts;
  const rangeLabel = statsRange === "week" ? "на этой неделе" : "за 30 дней";
  const prevLabel = statsRange === "week" ? "с прошлой неделей" : "с прошлым периодом";
  const colors = ["#58cc02", "#ff9a00", "#1d73e8", "#a560f0"];

  const exNames = exerciseNamesInState(s.days);
  const exBlocks = exNames
    .map((name, index) => {
      const points = exercisePoints(s.days, name, dates);
      const previous = exercisePoints(s.days, name, previousDates);
      const total = points.reduce((a, p) => a + p.value, 0);
      const totalSets = points.reduce((a, p) => a + p.sets, 0);
      const previousTotal = previous.reduce((a, p) => a + p.value, 0);
      const active = points.filter((p) => p.value > 0);
      const best = active.reduce((acc, p) => (p.value > acc.value ? p : acc), { value: 0, label: "—" });
      const avg = active.length ? Math.round((total / active.length) * 10) / 10 : 0;
      const delta = percentDelta(total, previousTotal);
      const color = colors[index % colors.length];
      const weightSeries = points
        .filter((p) => p.weight != null)
        .map((p) => ({ date: p.date, label: p.label, value: p.weight }));
      if (!total && !weightSeries.length) return "";
      return `<section class="card stat-card exercise-stat">
        <div class="stat-card-head">
          <div class="title">${esc(name)}</div>
          <div class="stat-pill" style="--pill-color:${color}">Всего: ${total}</div>
        </div>
        ${Charts.barChart(points, color)}
        <div class="stat-tiles">
          ${statTile("Среднее", avg, "повт.")}
          ${statTile("Лучший день", best.value, best.label)}
          ${statTile("Подходы", totalSets, "за период")}
        </div>
        <div class="stat-progress" style="--progress-color:${color}">
          <b>${delta > 0 ? "+" : ""}${delta}%</b><span>${prevLabel}</span>
        </div>
        ${
          weightSeries.length
            ? `<div class="weight-exercise-chart">
                <div class="mini-title">Вес в упражнении</div>
                ${Charts.lineChart(weightSeries, color)}
              </div>`
            : ""
        }
      </section>`;
    })
    .join("");

  const weightSeries = [...s.weighIns]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-count)
    .map((x) => ({ date: x.date, label: chartDayLabel(x.date, statsRange), value: x.weight }));
  const avgWeight = weightSeries.length
    ? Math.round((weightSeries.reduce((a, p) => a + Number(p.value), 0) / weightSeries.length) * 10) / 10
    : 0;
  const weightChange = weightSeries.length > 1
    ? Math.round((weightSeries[weightSeries.length - 1].value - weightSeries[0].value) * 10) / 10
    : 0;
  const minWeight = weightSeries.reduce((acc, p) => (Number(p.value) < Number(acc.value) ? p : acc), weightSeries[0] || { value: 0, label: "—" });

  screens.stats.innerHTML = `
    <div class="stats-top">
      <h1>Статистика</h1>
      <div class="segmented">
        <button class="${statsRange === "week" ? "active" : ""}" data-stats-range="week">Неделя</button>
        <button class="${statsRange === "month" ? "active" : ""}" data-stats-range="month">Месяц</button>
      </div>
    </div>
    <section class="card stat-summary">
      <div>
        <div class="eyebrow">Всего тренировок</div>
        <div class="stat-big">${totalWorkouts}</div>
        <div class="muted-line">${rangeLabel}</div>
      </div>
      <div class="stat-compare">
        <b>${workoutDelta > 0 ? "+" : ""}${workoutDelta}</b>
        <span>${prevLabel}</span>
      </div>
    </section>
    ${exBlocks}
    <section class="card stat-card">
      <div class="stat-card-head">
        <div class="title">Вес</div>
        <div class="stat-pill blue">Средний: ${avgWeight} кг</div>
      </div>
      ${Charts.lineChart(weightSeries, "#3b82f6")}
      <div class="stat-tiles">
        ${statTile("Изменение", `${weightChange > 0 ? "+" : ""}${weightChange} кг`, "за период")}
        ${statTile("Лучшая отметка", `${minWeight.value} кг`, minWeight.label)}
        ${statTile("Записей", weightSeries.length, "за период")}
      </div>
    </section>
  `;
  document.querySelectorAll("[data-stats-range]").forEach((btn) =>
    btn.addEventListener("click", () => {
      statsRange = btn.dataset.statsRange;
      renderStats();
    })
  );
}

function renderHabitCalendar() {
  const s = store.get();
  const today = todayISO();
  const days = [];
  for (let i = 13; i >= 0; i--) days.push(L.addDays(today, -i));
  const rows = s.habits
    .map((h) => {
      const cells = days
        .map((iso) => {
          const done = s.days[iso] && s.days[iso].habits && s.days[iso].habits[h.id];
          return `<span class="cal-cell ${done ? "on" : ""}"></span>`;
        })
        .join("");
      return `<div class="cal-row"><span class="cal-name">${esc(h.name)}</span><div class="cal-cells">${cells}</div></div>`;
    })
    .join("");
  document.getElementById("habit-cal").innerHTML = `
    <div class="card"><div class="eyebrow">Привычки · 14 дней</div>${rows}</div>`;
}

// ---------- Экран «Настройки» ----------
function renderSettings() {
  const s = store.get();
  screens.settings.innerHTML = `
    <h1>Настройки</h1>
    <div class="card">
      <div class="eyebrow">Счётчики</div>
      <div class="field">Без алкоголя с<input type="date" id="set-alco" value="${s.settings.noAlcoholStart}"></div>
      <div class="field">Без спреев с<input type="date" id="set-spray" value="${s.settings.noSpraysStart}"></div>
      <div class="field">Челлендж: старт (день 1)<input type="date" id="set-ch-start" value="${s.settings.challenge.startDate}"></div>
      <div class="field">Челлендж: якорь отсчёта<input type="date" id="set-ch-anchor" value="${s.settings.challenge.anchorDate}"></div>
      <div class="field">Челлендж: остаток на якоре<input type="number" id="set-ch-rem" value="${s.settings.challenge.remainingAtAnchor}"></div>
      <div class="field">Взвешивание: якорь<input type="date" id="set-w-anchor" value="${s.settings.weighIn.anchorDate}"></div>
      <div class="field">Взвешивание: интервал, дней<input type="number" id="set-w-int" value="${s.settings.weighIn.intervalDays}"></div>
      <button class="btn" id="save-settings">Сохранить</button>
      <button class="btn ghost" id="reset-alco">Сбросить «без алкоголя» на сегодня</button>
      <button class="btn ghost" id="reset-spray">Сбросить «без спреев» на сегодня</button>
    </div>
    <div class="card"><div class="eyebrow">Упражнения</div><div id="ex-list"></div>
      <button class="btn ghost" id="add-ex-preset">Добавить упражнение</button></div>
    <div class="card"><div class="eyebrow">Привычки</div><div id="habit-list"></div>
      <button class="btn ghost" id="add-habit">Добавить привычку</button></div>
    <div class="card"><div class="eyebrow">Замеры веса</div><div id="weigh-list"></div>
      <button class="btn ghost" id="add-weigh">Добавить замер</button></div>
    <div class="card"><div class="eyebrow">Синхронизация · <span id="sync-status">${syncStatusLabel()}</span></div>
      <div class="field">Адрес API<input type="url" id="sync-url" value="${esc(syncCfg.apiUrl)}" placeholder="https://домен/trackerapi"></div>
      <div class="field">Ключ<input type="password" id="sync-token" value="${esc(syncCfg.token)}" placeholder="токен"></div>
      <button class="btn" id="sync-save">Сохранить и синхронизировать</button>
      <button class="btn ghost" id="sync-now">Синхронизировать сейчас</button></div>
    <div class="card"><div class="eyebrow">Бэкап</div>
      <button class="btn blue" id="export">Экспорт в файл</button>
      <button class="btn ghost" id="import">Импорт из файла</button>
      <input type="file" id="import-file" accept="application/json" hidden></div>
    <div class="app-version">Версия ${APP_VERSION}</div>
  `;
  wireSettings();
}

function wireSettings() {
  const today = todayISO();
  document.getElementById("save-settings").addEventListener("click", () => {
    const s = store.get();
    s.settings.noAlcoholStart = document.getElementById("set-alco").value;
    s.settings.noSpraysStart = document.getElementById("set-spray").value;
    s.settings.challenge.startDate = document.getElementById("set-ch-start").value;
    s.settings.challenge.anchorDate = document.getElementById("set-ch-anchor").value;
    s.settings.challenge.remainingAtAnchor = parseInt(document.getElementById("set-ch-rem").value, 10);
    s.settings.weighIn.anchorDate = document.getElementById("set-w-anchor").value;
    s.settings.weighIn.intervalDays = parseInt(document.getElementById("set-w-int").value, 10);
    saveState(s);
    alert("Сохранено");
  });
  document.getElementById("reset-alco").addEventListener("click", () => {
    if (!confirm("Обнулить счётчик «без алкоголя» на сегодня?")) return;
    const s = store.get();
    s.settings.noAlcoholStart = today;
    saveState(s);
    renderSettings();
  });
  document.getElementById("reset-spray").addEventListener("click", () => {
    if (!confirm("Обнулить счётчик «без спреев» на сегодня?")) return;
    const s = store.get();
    s.settings.noSpraysStart = today;
    saveState(s);
    renderSettings();
  });

  renderEditableList("ex-list", "exercises", "add-ex-preset");
  renderEditableList("habit-list", "habits", "add-habit");
  renderWeighList();

  document.getElementById("export").addEventListener("click", exportData);
  document.getElementById("import").addEventListener("click", () => document.getElementById("import-file").click());
  document.getElementById("import-file").addEventListener("change", importData);

  document.getElementById("sync-save").addEventListener("click", async () => {
    syncCfg = {
      apiUrl: document.getElementById("sync-url").value.trim(),
      token: document.getElementById("sync-token").value.trim(),
    };
    Sync.saveSyncConfig(window.localStorage, syncCfg);
    await pullOnStart();
    renderSettings();
  });
  document.getElementById("sync-now").addEventListener("click", async () => {
    await pushNow();
    renderSettings();
  });
}

function renderEditableList(containerId, key, addBtnId) {
  const s = store.get();
  document.getElementById(containerId).innerHTML = s[key]
    .map(
      (item, i) => `<div class="edit-row">
        <input data-key="${key}" data-i="${i}" value="${esc(item.name)}" />
        <button class="icon-x" data-del="${key}" data-i="${i}">${ICON.x}</button></div>`
    )
    .join("");
  document.querySelectorAll(`#${containerId} input`).forEach((inp) =>
    inp.addEventListener("change", () => {
      const st = store.get();
      st[inp.dataset.key][+inp.dataset.i].name = inp.value;
      saveState(st);
    })
  );
  document.querySelectorAll(`#${containerId} [data-del]`).forEach((b) =>
    b.addEventListener("click", () => {
      const st = store.get();
      st[b.dataset.del].splice(+b.dataset.i, 1);
      saveState(st);
      renderSettings();
    })
  );
  document.getElementById(addBtnId).addEventListener("click", () => {
    const name = prompt("Название?");
    if (!name) return;
    const st = store.get();
    const id = name.toLowerCase().replace(/\s+/g, "-") + "-" + st[key].length;
    if (key === "exercises") st.exercises.push({ id, name, type: "reps", preset: false });
    else st.habits.push({ id, name });
    saveState(st);
    renderSettings();
  });
}

function renderWeighList() {
  const s = store.get();
  document.getElementById("weigh-list").innerHTML = s.weighIns
    .map(
      (wi, i) => `<div class="edit-row weigh-row">
        <input type="date" data-wi="${i}" data-f="date" value="${wi.date}" />
        <input type="number" step="0.1" inputmode="decimal" data-wi="${i}" data-f="weight" value="${wi.weight}" />
        <button class="icon-x" data-del-wi="${i}">${ICON.x}</button></div>`
    )
    .join("");
  document.querySelectorAll("#weigh-list input").forEach((inp) =>
    inp.addEventListener("change", () => {
      const st = store.get();
      const wi = st.weighIns[+inp.dataset.wi];
      if (inp.dataset.f === "date") wi.date = inp.value;
      else wi.weight = parseFloat(inp.value) || 0;
      saveState(st);
    })
  );
  document.querySelectorAll("#weigh-list [data-del-wi]").forEach((b) =>
    b.addEventListener("click", () => {
      const st = store.get();
      st.weighIns.splice(+b.dataset.delWi, 1);
      saveState(st);
      renderSettings();
    })
  );
  document.getElementById("add-weigh").addEventListener("click", () => {
    const st = store.get();
    st.weighIns.push({ date: todayISO(), weight: 0 });
    saveState(st);
    renderSettings();
  });
}

function exportData() {
  const blob = new Blob([store.exportJSON()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "tracker-backup-" + todayISO() + ".json";
  a.click();
  URL.revokeObjectURL(url);
}

function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      store.importJSON(reader.result);
      alert("Импортировано");
      currentDay = todayISO();
      show("today");
    } catch (err) {
      alert("Не удалось импортировать: " + err.message);
    }
  };
  reader.readAsText(file);
}

// ---------- Старт ----------
let renderedChallengePhoto = challengePhotoIndex();
show("today");
pullOnStart();

setInterval(() => {
  const nextPhoto = challengePhotoIndex();
  if (nextPhoto === renderedChallengePhoto) return;
  renderedChallengePhoto = nextPhoto;
  if (!screens.today.classList.contains("hidden") && todayRoute === "main") renderToday();
}, 60 * 1000);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () =>
    navigator.serviceWorker.register("sw.js").catch(() => {})
  );
}
