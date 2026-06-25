import { createStore } from "./storage.js";
import * as L from "./logic.js";
import * as Charts from "./charts.js";

const store = createStore(window.localStorage);

const screens = {
  today: document.getElementById("screen-today"),
  stats: document.getElementById("screen-stats"),
  settings: document.getElementById("screen-settings"),
};

function todayISO() {
  return L.toISO(new Date());
}
let currentDay = todayISO(); // выбранный на экране «Сегодня» день

// Экранирование для вставки в HTML-атрибуты и текст.
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

// --- Навигация по вкладкам ---

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

// --- Экран «Сегодня» ---

function counterCard(title, big, small, color) {
  return `<div class="card counter ${color}">
    <div class="counter-title">${title}</div>
    <div class="counter-big">${big}</div>
    <div class="counter-small">${small}</div></div>`;
}

function renderToday() {
  const s = store.get();
  const today = todayISO();
  const label = currentDay === today ? "Сегодня" : currentDay;

  const ch = s.settings.challenge;
  const rem = L.challengeRemaining(ch, today);
  const dayNo = L.challengeDayNumber(ch, today);
  const noAlco = L.daysSince(s.settings.noAlcoholStart, today);
  const noSpray = L.daysSince(s.settings.noSpraysStart, today);

  const w = s.settings.weighIn;
  const isWeigh = L.isWeighInDay(w, today);
  const nextW = L.nextWeighInDate(w, today);
  const lastW = L.lastWeighInValue(s.weighIns, today);
  const weighPanel = `<div class="card weigh ${isWeigh ? "due" : ""}">
    <div class="counter-title">⚖️ Взвешивание</div>
    <div class="counter-big">${lastW != null ? lastW + " кг" : "—"}</div>
    <div class="counter-small">${isWeigh ? "Сегодня день взвешивания!" : "Следующее: " + nextW}</div>
    ${
      isWeigh
        ? `<div class="weigh-input"><input id="weigh-val" type="number" step="0.1" inputmode="decimal" placeholder="кг" />
      <button class="btn blue" id="weigh-save">Записать</button></div>`
        : ""
    }
  </div>`;

  screens.today.innerHTML = `
    <div class="day-nav">
      <button class="navbtn" id="day-prev">‹</button>
      <h1>${label}</h1>
      <button class="navbtn" id="day-next">›</button>
    </div>
    <div class="counters">
      ${counterCard("🔥 Челлендж", "Осталось " + rem, "День " + dayNo + " из 75", "green")}
      ${counterCard("🍺 Без алкоголя", noAlco + " дн.", "с " + s.settings.noAlcoholStart, "blue")}
      ${counterCard("💨 Без спреев", noSpray + " дн.", "с " + s.settings.noSpraysStart, "purple")}
    </div>
    ${weighPanel}
    <div id="today-workouts"></div>
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
      store.set(st);
      renderToday();
    });
  }

  renderWorkouts();
  renderHabits();
  renderNote();
}

function renderWorkouts() {
  const s = store.get();
  const day = getDay(s, currentDay);
  const presets = s.exercises
    .map((e) => `<button class="chip" data-add-ex="${esc(e.id)}">${esc(e.name)}</button>`)
    .join("");
  const list = (day.workouts || [])
    .map((wk, i) => {
      if (wk.type === "cardio") {
        return `<div class="wk"><b>${esc(wk.name)}</b>
        <input class="cardio" data-wk="${i}" value="${esc(wk.value || "")}" placeholder="5 км / 30 мин" />
        <button class="x" data-del-wk="${i}">✕</button></div>`;
      }
      const sets = (wk.sets || [])
        .map(
          (r, si) =>
            `<input class="set" type="number" inputmode="numeric" data-wk="${i}" data-set="${si}" value="${r}" />`
        )
        .join("");
      return `<div class="wk"><b>${esc(wk.name)}</b>
      <div class="sets">${sets}<button class="set-add" data-addset="${i}">＋</button></div>
      <button class="x" data-del-wk="${i}">✕</button></div>`;
    })
    .join("");

  document.getElementById("today-workouts").innerHTML = `
    <div class="card">
      <div class="section-title">🏋️ Тренировка</div>
      <div class="chips">${presets}<button class="chip ghost" id="add-custom">＋ своё</button></div>
      <div class="wk-list">${list}</div>
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
      store.set(s);
      renderWorkouts();
    })
  );

  document.getElementById("add-custom").addEventListener("click", () => {
    const name = prompt("Название упражнения?");
    if (!name) return;
    const isCardio = confirm("Это кардио (бег и т.п.)? OK — да, Отмена — подходы×повторы");
    const s = store.get();
    const day = getDay(s, currentDay);
    day.workouts.push(
      isCardio
        ? { name, type: "cardio", value: "" }
        : { name, type: "reps", sets: [0] }
    );
    store.set(s);
    renderWorkouts();
  });

  document.querySelectorAll("input.set").forEach((inp) =>
    inp.addEventListener("change", () => {
      const s = store.get();
      const day = getDay(s, currentDay);
      day.workouts[+inp.dataset.wk].sets[+inp.dataset.set] =
        parseInt(inp.value, 10) || 0;
      store.set(s);
    })
  );

  document.querySelectorAll("input.cardio").forEach((inp) =>
    inp.addEventListener("change", () => {
      const s = store.get();
      getDay(s, currentDay).workouts[+inp.dataset.wk].value = inp.value;
      store.set(s);
    })
  );

  document.querySelectorAll("[data-addset]").forEach((b) =>
    b.addEventListener("click", () => {
      const s = store.get();
      getDay(s, currentDay).workouts[+b.dataset.addset].sets.push(0);
      store.set(s);
      renderWorkouts();
    })
  );

  document.querySelectorAll("[data-del-wk]").forEach((b) =>
    b.addEventListener("click", () => {
      const s = store.get();
      getDay(s, currentDay).workouts.splice(+b.dataset.delWk, 1);
      store.set(s);
      renderWorkouts();
    })
  );
}

function renderHabits() {
  const s = store.get();
  const day = getDay(s, currentDay);
  const today = todayISO();
  const items = s.habits
    .map((h) => {
      const done = !!(day.habits && day.habits[h.id]);
      const streak = L.habitStreak(s.days, h.id, currentDay);
      return `<button class="habit ${done ? "done" : ""}" data-habit="${esc(h.id)}">
      <span>${done ? "✅" : "⬜️"} ${esc(h.name)}</span>
      <span class="streak">${streak > 0 ? "🔥 " + streak : ""}</span></button>`;
    })
    .join("");
  document.getElementById("today-habits").innerHTML =
    `<div class="card"><div class="section-title">✨ Привычки</div>${items}</div>`;

  document.querySelectorAll("[data-habit]").forEach((b) =>
    b.addEventListener("click", () => {
      const st = store.get();
      const d = getDay(st, currentDay);
      d.habits[b.dataset.habit] = !d.habits[b.dataset.habit];
      store.set(st);
      const allDone = st.habits.length > 0 && st.habits.every((h) => d.habits[h.id]);
      renderHabits();
      if (allDone && currentDay === today) celebrate();
    })
  );
}

function renderNote() {
  const s = store.get();
  const day = getDay(s, currentDay);
  document.getElementById("today-note").innerHTML =
    `<div class="card"><div class="section-title">📝 Заметка</div>
     <textarea id="note-area" rows="3" placeholder="как прошёл день…">${esc(day.note || "")}</textarea></div>`;
  document.getElementById("note-area").addEventListener("change", (e) => {
    const st = store.get();
    getDay(st, currentDay).note = e.target.value;
    store.set(st);
  });
}

function celebrate() {
  const layer = document.createElement("div");
  layer.className = "confetti";
  const colors = ["#58cc02", "#1cb0f6", "#ff9600", "#ce82ff", "#ff4b4b"];
  for (let i = 0; i < 30; i++) {
    const p = document.createElement("i");
    p.style.left = (i / 30) * 100 + "%";
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = (i % 10) * 0.05 + "s";
    layer.appendChild(p);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 1600);
}

// --- Экран «Статистика» ---

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
      const series = L.repsPerDay(s.days, name);
      return `<div class="card"><div class="section-title">${esc(name)} — повторов за день</div>
      ${Charts.barChart(series, "#58cc02")}</div>`;
    })
    .join("");

  const weightSeries = [...s.weighIns]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((x) => ({ date: x.date, value: x.weight }));

  screens.stats.innerHTML = `
    <h1>Статистика</h1>
    <div class="card"><div class="section-title">Всего тренировок</div>
      <div class="counter-big" style="color:var(--green)">${L.totalWorkouts(s.days)}</div></div>
    ${exBlocks}
    <div class="card"><div class="section-title">⚖️ Вес</div>
      ${Charts.lineChart(weightSeries, "#1cb0f6")}</div>
    <div id="habit-cal"></div>
  `;
  renderHabitCalendar();
}

function renderHabitCalendar() {
  const s = store.get();
  const today = todayISO();
  const days = [];
  for (let i = 13; i >= 0; i--) days.push(L.addDays(today, -i)); // последние 14 дней
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
  document.getElementById("habit-cal").innerHTML =
    `<div class="card"><div class="section-title">Привычки за 14 дней</div>${rows}</div>`;
}

// --- Экран «Настройки» ---

function renderSettings() {
  const s = store.get();
  screens.settings.innerHTML = `
    <h1>Настройки</h1>
    <div class="card"><div class="section-title">Счётчики</div>
      <label>Без алкоголя с<input type="date" id="set-alco" value="${s.settings.noAlcoholStart}"></label>
      <label>Без спреев с<input type="date" id="set-spray" value="${s.settings.noSpraysStart}"></label>
      <label>Челлендж: якорь<input type="date" id="set-ch-anchor" value="${s.settings.challenge.anchorDate}"></label>
      <label>Челлендж: остаток на якоре<input type="number" id="set-ch-rem" value="${s.settings.challenge.remainingAtAnchor}"></label>
      <label>Взвешивание: якорь<input type="date" id="set-w-anchor" value="${s.settings.weighIn.anchorDate}"></label>
      <label>Взвешивание: интервал (дней)<input type="number" id="set-w-int" value="${s.settings.weighIn.intervalDays}"></label>
      <button class="btn" id="save-settings">Сохранить</button>
      <button class="btn ghost" id="reset-alco">Сброс «без алко» на сегодня</button>
      <button class="btn ghost" id="reset-spray">Сброс «без спреев» на сегодня</button>
    </div>
    <div class="card"><div class="section-title">Упражнения</div>
      <div id="ex-list"></div>
      <button class="btn ghost" id="add-ex-preset">＋ упражнение</button></div>
    <div class="card"><div class="section-title">Привычки</div>
      <div id="habit-list"></div>
      <button class="btn ghost" id="add-habit">＋ привычка</button></div>
    <div class="card"><div class="section-title">Бэкап</div>
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
    s.settings.challenge.remainingAtAnchor = parseInt(
      document.getElementById("set-ch-rem").value,
      10
    );
    s.settings.weighIn.anchorDate = document.getElementById("set-w-anchor").value;
    s.settings.weighIn.intervalDays = parseInt(
      document.getElementById("set-w-int").value,
      10
    );
    store.set(s);
    alert("Сохранено");
  });
  document.getElementById("reset-alco").addEventListener("click", () => {
    if (!confirm("Обнулить счётчик «без алкоголя» на сегодня?")) return;
    const s = store.get();
    s.settings.noAlcoholStart = today;
    store.set(s);
    renderSettings();
  });
  document.getElementById("reset-spray").addEventListener("click", () => {
    if (!confirm("Обнулить счётчик «без спреев» на сегодня?")) return;
    const s = store.get();
    s.settings.noSpraysStart = today;
    store.set(s);
    renderSettings();
  });

  renderEditableList("ex-list", "exercises", "add-ex-preset");
  renderEditableList("habit-list", "habits", "add-habit");

  document.getElementById("export").addEventListener("click", exportData);
  document
    .getElementById("import")
    .addEventListener("click", () => document.getElementById("import-file").click());
  document.getElementById("import-file").addEventListener("change", importData);
}

function renderEditableList(containerId, key, addBtnId) {
  const s = store.get();
  document.getElementById(containerId).innerHTML = s[key]
    .map(
      (item, i) =>
        `<div class="edit-row"><input data-key="${key}" data-i="${i}" value="${esc(item.name)}" />
     <button class="x" data-del="${key}" data-i="${i}">✕</button></div>`
    )
    .join("");
  document.querySelectorAll(`#${containerId} input`).forEach((inp) =>
    inp.addEventListener("change", () => {
      const st = store.get();
      st[inp.dataset.key][+inp.dataset.i].name = inp.value;
      store.set(st);
    })
  );
  document.querySelectorAll(`#${containerId} [data-del]`).forEach((b) =>
    b.addEventListener("click", () => {
      const st = store.get();
      st[b.dataset.del].splice(+b.dataset.i, 1);
      store.set(st);
      renderSettings();
    })
  );
  document.getElementById(addBtnId).addEventListener("click", () => {
    const name = prompt("Название?");
    if (!name) return;
    const st = store.get();
    const id = name.toLowerCase().replace(/\s+/g, "-") + "-" + st[key].length;
    if (key === "exercises")
      st.exercises.push({ id, name, type: "reps", preset: false });
    else st.habits.push({ id, name });
    store.set(st);
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

// --- Старт ---

show("today");

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () =>
    navigator.serviceWorker.register("sw.js").catch(() => {})
  );
}
