import { createStore } from "./storage.js";
import * as L from "./logic.js";
import * as Charts from "./charts.js";
import * as Sync from "./sync.js";

const store = createStore(window.localStorage);

let syncCfg = Sync.loadSyncConfig(window.localStorage);
let syncStatus = "idle"; // idle | syncing | ok | offline

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

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
  .forEach((t) => t.addEventListener("click", () => show(t.dataset.tab)));

// ---------- Экран «Сегодня» ----------
function renderToday() {
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
      <div class="counter hero">
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
    renderToday();
  });
  document.getElementById("day-next").addEventListener("click", () => {
    currentDay = L.addDays(currentDay, 1);
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

function renderNutrition() {
  const s = store.get();
  const day = getDay(s, currentDay);
  const n = day.nutrition || { kcal: 0, p: 0, f: 0, c: 0 };
  document.getElementById("today-nutrition").innerHTML = `
    <div class="card">
      <div class="section-head"><div class="title">Питание</div></div>
      <label class="nutri-kcal">Калории за день
        <input type="number" inputmode="numeric" id="n-kcal" value="${n.kcal || ""}" placeholder="ккал" /></label>
      <div class="nutri-macros">
        <label>Белки<input type="number" inputmode="numeric" id="n-p" value="${n.p || ""}" placeholder="г" /></label>
        <label>Жиры<input type="number" inputmode="numeric" id="n-f" value="${n.f || ""}" placeholder="г" /></label>
        <label>Углеводы<input type="number" inputmode="numeric" id="n-c" value="${n.c || ""}" placeholder="г" /></label>
      </div>
    </div>`;

  const save = () => {
    const st = store.get();
    getDay(st, currentDay).nutrition = {
      kcal: parseInt(document.getElementById("n-kcal").value, 10) || 0,
      p: parseInt(document.getElementById("n-p").value, 10) || 0,
      f: parseInt(document.getElementById("n-f").value, 10) || 0,
      c: parseInt(document.getElementById("n-c").value, 10) || 0,
    };
    saveState(st);
  };
  ["n-kcal", "n-p", "n-f", "n-c"].forEach((id) =>
    document.getElementById(id).addEventListener("change", save)
  );
}

function sumSets(sets) {
  return (sets || []).reduce((a, b) => a + b, 0);
}

function renderWorkouts() {
  const s = store.get();
  const day = getDay(s, currentDay);
  const chips =
    s.exercises
      .map((e) => `<button class="chip" data-add-ex="${esc(e.id)}">${esc(e.name)}</button>`)
      .join("") + `<button class="chip add" id="add-custom">${ICON.plus} своё</button>`;

  const blocks = (day.workouts || [])
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
          (r, si) => `<div class="set-row">
            <span class="set-idx">Подход ${si + 1}</span>
            <div class="stepper">
              <button class="step minus" data-wk="${i}" data-set="${si}" data-d="-1">−</button>
              <span class="step-val" id="val-${i}-${si}">${r}</span>
              <button class="step plus" data-wk="${i}" data-set="${si}" data-d="1">+</button>
            </div></div>`
        )
        .join("");
      return `<div class="ex-block">
        <div class="ex-head"><span class="ex-name">${esc(wk.name)}</span>
          <button class="ex-del" data-del-wk="${i}">${ICON.x}</button></div>
        <div class="set-rows">${rows}</div>
        <button class="add-set" data-addset="${i}">Добавить подход</button>
        <div class="ex-total">Всего: <b id="total-${i}">${sumSets(wk.sets)}</b></div>
      </div>`;
    })
    .join("");

  const body = blocks || `<div class="empty-hint">Нажми упражнение выше, чтобы записать подходы.</div>`;

  document.getElementById("today-workouts").innerHTML = `
    <div class="card">
      <div class="section-head"><div class="title">Тренировка</div></div>
      <div class="chips">${chips}</div>
      ${body}
    </div>`;

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
      renderWorkouts();
    })
  );

  document.getElementById("add-custom").addEventListener("click", () => {
    const name = prompt("Название упражнения?");
    if (!name) return;
    const isCardio = confirm("Это кардио (бег и т.п.)?  OK — да,  Отмена — подходы.");
    const s = store.get();
    const day = getDay(s, currentDay);
    day.workouts.push(
      isCardio ? { name, type: "cardio", value: "" } : { name, type: "reps", sets: [0] }
    );
    saveState(s);
    renderWorkouts();
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
      document.getElementById(`val-${wk}-${si}`).textContent = v;
      document.getElementById(`total-${wk}`).textContent = sumSets(day.workouts[wk].sets);
    })
  );

  document.querySelectorAll("[data-addset]").forEach((b) =>
    b.addEventListener("click", () => {
      const s = store.get();
      const sets = getDay(s, currentDay).workouts[+b.dataset.addset].sets;
      sets.push(sets.length ? sets[sets.length - 1] : 0); // копируем прошлый подход
      saveState(s);
      renderWorkouts();
    })
  );

  document.querySelectorAll("input.cardio-input").forEach((inp) =>
    inp.addEventListener("change", () => {
      const s = store.get();
      getDay(s, currentDay).workouts[+inp.dataset.wk].value = inp.value;
      saveState(s);
    })
  );

  document.querySelectorAll("[data-del-wk]").forEach((b) =>
    b.addEventListener("click", () => {
      const s = store.get();
      getDay(s, currentDay).workouts.splice(+b.dataset.delWk, 1);
      saveState(s);
      renderWorkouts();
    })
  );
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
function renderStats() {
  const s = store.get();
  const exNames = [
    ...new Set(
      Object.values(s.days).flatMap((d) =>
        (d.workouts || []).filter((w) => w.type === "reps").map((w) => w.name)
      )
    ),
  ];
  const exBlocks = exNames
    .map((name) => {
      const series = L.repsPerDay(s.days, name).slice(-10); // последние 10 тренировок
      return `<div class="card">
        <div class="section-head"><div class="title">${esc(name)}</div></div>
        ${Charts.barChart(series, "#58cc02")}</div>`;
    })
    .join("");

  const weightSeries = [...s.weighIns]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((x) => ({ date: x.date, value: x.weight }));

  screens.stats.innerHTML = `
    <h1>Статистика</h1>
    <div class="card"><div class="eyebrow">Всего тренировок</div><div class="stat-big">${L.totalWorkouts(s.days)}</div></div>
    ${exBlocks}
    <div class="card"><div class="section-head"><div class="title">Вес</div></div>${Charts.lineChart(weightSeries, "#1cb0f6")}</div>
    <div class="card"><div class="section-head"><div class="title">Калории</div></div>${Charts.lineChart(L.caloriesPerDay(s.days).slice(-14), "#ff9a00")}</div>
    <div id="habit-cal"></div>
  `;
  renderHabitCalendar();
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
      <div class="field">Челлендж: якорь<input type="date" id="set-ch-anchor" value="${s.settings.challenge.anchorDate}"></div>
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
  `;
  wireSettings();
}

function wireSettings() {
  const today = todayISO();
  document.getElementById("save-settings").addEventListener("click", () => {
    const s = store.get();
    s.settings.noAlcoholStart = document.getElementById("set-alco").value;
    s.settings.noSpraysStart = document.getElementById("set-spray").value;
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
      (wi, i) => `<div class="edit-row">
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
show("today");
pullOnStart();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () =>
    navigator.serviceWorker.register("sw.js").catch(() => {})
  );
}
