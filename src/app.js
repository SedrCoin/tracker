import { createStore } from "./storage.js";
import * as L from "./logic.js";
import * as Charts from "./charts.js";
import * as Sync from "./sync.js";

const store = createStore(window.localStorage);

let syncCfg = Sync.loadSyncConfig(window.localStorage);
let syncStatus = "idle"; // idle | syncing | ok | offline
const APP_VERSION = "20260703-7";
let todayRoute = "main"; // main | workouts | nutrition
let statsRange = "week"; // week | month
let statsEndDay = null;
let calendarOpen = false;
let customExerciseOpen = false;
let chipMenuExerciseId = null;
let chipRenameOpen = false;
const collapsedWorkouts = new Set();
let onboardingStep = 0;
let onboardingDraft = null;

const MEALS = [
  { key: "breakfast", name: "Завтрак" },
  { key: "lunch", name: "Обед" },
  { key: "dinner", name: "Ужин" },
  { key: "snack", name: "Перекус" },
];
const MEASUREMENT_FIELDS = [
  { key: "biceps", name: "Бицепс", short: "Биц" },
  { key: "waist", name: "Талия", short: "Тал" },
  { key: "thigh", name: "Бедро", short: "Бед" },
  { key: "chest", name: "Грудь", short: "Гр" },
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
  bell: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 10-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>`,
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

function accountLabel() {
  if (Sync.isConfigured(syncCfg)) return "Аккаунт подключён";
  return "Локальный профиль";
}

function profileComplete(state) {
  return !!(state.settings && state.settings.profile && state.settings.profile.name);
}

function profileAvatar(profile) {
  if (profile && profile.photo) return `<img src="${esc(profile.photo)}" alt="">`;
  const letter = ((profile && profile.name) || "?").trim().charAt(0).toUpperCase() || "?";
  return `<span>${esc(letter)}</span>`;
}

function readImageDataUrl(file, maxSide = 512, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Не удалось прочитать фото"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Не удалось открыть фото"));
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
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

function normalizeId(name, existing = []) {
  const base =
    String(name)
      .trim()
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[^a-zа-я0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "") || "item";
  let id = base;
  let n = 1;
  const used = new Set(existing.map((x) => x.id));
  while (used.has(id)) id = `${base}-${n++}`;
  return id;
}

function sameName(a, b) {
  return exerciseKey(a) === exerciseKey(b);
}

function cleanExerciseName(name) {
  const cleaned = String(name || "")
    .replace(/[«»"']/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : "Упражнение";
}

function exerciseKey(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"']/g, "")
    .replace(/[^a-zа-я0-9]+/gi, "");
}

function uniqueExercises(exercises) {
  const seen = new Set();
  return exercises.filter((ex) => {
    const key = exerciseKey(ex.name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
      customExerciseOpen = false;
    }
    show(t.dataset.tab);
  }));

// ---------- Экран «Сегодня» ----------
function renderToday() {
  const initialState = store.get();
  if (!profileComplete(initialState)) {
    renderOnboarding(initialState);
    return;
  }
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
  const profile = s.settings.profile || {};

  let big, sub;
  if (currentDay === today) { big = "Сегодня"; sub = weekday(currentDay) + ", " + dayMonth(currentDay); }
  else if (currentDay === L.addDays(today, -1)) { big = "Вчера"; sub = weekday(currentDay) + ", " + dayMonth(currentDay); }
  else if (currentDay === L.addDays(today, 1)) { big = "Завтра"; sub = weekday(currentDay) + ", " + dayMonth(currentDay); }
  else { big = dayMonth(currentDay); sub = weekday(currentDay); }

  const ch = s.settings.challenge || {};
  const targetDays = ch.targetDays || 75;
  const rem = ch.enabled ? L.challengeRemaining(ch, today) : 0;
  const dayNo = ch.enabled ? L.challengeDayNumber(ch, today) : 0;
  const challengePhoto = challengePhotoIndex();
  const challengeProgress = Math.round(Math.min(1, Math.max(0, dayNo / targetDays)) * 360);
  const counters = Array.isArray(s.settings.counters) ? s.settings.counters : [];
  const customChallengeBg = ch.photoUrl ? `background-image:url("${esc(ch.photoUrl)}")` : "";
  const counterCards = counters
    .map((c, i) => {
      const tone = c.tone || (i % 2 ? "spray" : "alco");
      const days = L.daysSince(c.startDate, today);
      return `<div class="counter ${esc(tone)}">
        <div class="c-label">${esc(c.name)}</div>
        <div class="c-big">${days}</div>
        <div class="c-sub">дней · с ${shortDate(c.startDate)}</div>
      </div>`;
    })
    .join("");

  const w = s.settings.weighIn;
  const isWeigh = L.isWeighInDay(w, today);
  const nextW = L.nextWeighInDate(w, today);
  const lastW = L.lastWeighInValue(s.weighIns, currentDay);

  screens.today.innerHTML = `
    <button class="account-hero" id="open-profile" aria-label="Открыть профиль">
      <div class="avatar">${profileAvatar(profile)}</div>
      <div class="account-title">
        <div class="big">${big}</div>
        <div class="sub">${sub}</div>
      </div>
      <span class="bell-btn" id="account-sync" aria-label="Синхронизировать">${ICON.bell}<i></i></span>
    </button>
    <div class="day-nav">
      <button class="navbtn" id="day-prev" aria-label="Назад">${ICON.chevL}</button>
      <button class="calendar-open-btn" id="open-calendar" aria-label="Открыть календарь">${dayMonth(currentDay)}</button>
      <button class="navbtn" id="day-next" aria-label="Вперёд">${ICON.chevR}</button>
    </div>
    <div id="day-calendar-layer">${calendarOpen ? calendarHtml(s, currentDay) : ""}</div>

    <div class="counters">
      ${ch.enabled ? `<div class="counter hero challenge-photo-${challengePhoto}" style="--challenge-progress: ${challengeProgress}deg; ${customChallengeBg}">
        <div class="c-label">Челлендж</div>
        <div class="c-row"><div class="c-big">${rem}</div><div class="c-pill">День ${dayNo} / ${targetDays}</div></div>
        <div class="c-sub">осталось дней</div>
      </div>` : ""}
      ${counterCards}
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
    <div id="today-measurements"></div>
    <div id="today-nutrition"></div>
    <div id="today-habits"></div>
    <div id="today-note"></div>
  `;

  document.getElementById("day-prev").addEventListener("click", () => {
    currentDay = L.addDays(currentDay, -1);
    todayRoute = "main";
    calendarOpen = false;
    renderToday();
  });
  document.getElementById("day-next").addEventListener("click", () => {
    currentDay = L.addDays(currentDay, 1);
    todayRoute = "main";
    calendarOpen = false;
    renderToday();
  });

  if (isWeigh) {
    document.getElementById("weigh-save").addEventListener("click", () => {
      const val = parseFloat(document.getElementById("weigh-val").value);
      if (!isFinite(val)) return;
      const st = store.get();
      st.weighIns = st.weighIns.filter((x) => x.date !== currentDay);
      st.weighIns.push({ date: currentDay, weight: val });
      saveState(st);
      renderToday();
    });
  }

  document.getElementById("open-profile").addEventListener("click", () => renderProfileEditor());
  const accountSync = document.getElementById("account-sync");
  if (accountSync) accountSync.addEventListener("click", async (e) => {
    e.stopPropagation();
    await pushNow();
    renderToday();
  });
  document.getElementById("open-calendar").addEventListener("click", () => {
    calendarOpen = true;
    renderToday();
  });
  wireDayCalendar();
  renderWorkouts();
  renderMeasurements();
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
    customExerciseOpen = false;
    renderToday();
  });
}

function renderOnboarding(state) {
  const existing = (state.settings && state.settings.profile) || {};
  if (!onboardingDraft) onboardingDraft = { name: existing.name || "", height: existing.height || "", weight: existing.weight || "", measurements: {}, photo: existing.photo || "" };
  const step = Math.max(0, Math.min(2, onboardingStep));
  const stepBody = [
    `<div class="onboard-step">
      <h1>Как тебя зовут?</h1>
      <p>Имя будет видно в профиле и поможет отделить твои данные от друзей.</p>
      <label class="onboard-field">Имя
        <input id="onboard-name" autocomplete="name" value="${esc(onboardingDraft.name)}" placeholder="Артём">
      </label>
    </div>`,
    `<div class="onboard-step">
      <h1>Рост и вес</h1>
      <p>Можно пропустить, но с ними прогресс по телу будет полезнее.</p>
      <div class="onboard-grid big-inputs">
        <label class="onboard-field">Рост
          <input id="onboard-height" type="number" inputmode="decimal" placeholder="см" value="${esc(onboardingDraft.height)}">
        </label>
        <label class="onboard-field">Вес
          <input id="onboard-weight" type="number" step="0.1" inputmode="decimal" placeholder="кг" value="${esc(onboardingDraft.weight)}">
        </label>
      </div>
    </div>`,
    `<div class="onboard-step">
      <h1>Замеры</h1>
      <p>Необязательно. Заполни сейчас или добавишь позже на главной.</p>
      <div class="onboard-grid measure">
        ${MEASUREMENT_FIELDS.map((f) => `<label class="onboard-field">${esc(f.name)}
          <input data-onboard-measure="${esc(f.key)}" type="number" step="0.1" inputmode="decimal" placeholder="см" value="${esc(onboardingDraft.measurements[f.key] || "")}">
        </label>`).join("")}
      </div>
    </div>`,
  ][step];
  screens.today.innerHTML = `
    <div class="onboarding">
      <div class="onboarding-card">
        <div class="onboard-top-actions">
          ${step > 0 ? `<button class="mini-link left" id="onboard-back">Назад</button>` : "<span></span>"}
          ${step > 0 ? `<button class="mini-link" id="onboard-skip">Пропустить</button>` : "<span></span>"}
        </div>
        <div class="onboard-progress">
          ${[0, 1, 2].map((i) => `<span class="${i <= step ? "active" : ""}"></span>`).join("")}
        </div>
        ${stepBody}
        <div class="onboard-actions">
          <button class="btn" id="onboard-next">${step === 2 ? "Войти" : "Дальше"}</button>
        </div>
        <div class="onboard-note" id="onboard-note">${Sync.isConfigured(syncCfg) ? "Создам аккаунт на сервере и включу синхронизацию." : "Пока сохраню профиль локально. Сервер можно подключить в настройках."}</div>
      </div>
    </div>`;

  const collectStep = () => {
    const nameInput = document.getElementById("onboard-name");
    if (nameInput) onboardingDraft.name = nameInput.value.trim();
    const heightInput = document.getElementById("onboard-height");
    if (heightInput) onboardingDraft.height = heightInput.value.trim();
    const weightInput = document.getElementById("onboard-weight");
    if (weightInput) onboardingDraft.weight = weightInput.value.trim();
    document.querySelectorAll("[data-onboard-measure]").forEach((inp) => {
      onboardingDraft.measurements[inp.dataset.onboardMeasure] = inp.value.trim();
    });
  };
  const finish = async () => {
    collectStep();
    if (!onboardingDraft.name) {
      onboardingStep = 0;
      renderOnboarding(store.get());
      setTimeout(() => {
        const note = document.getElementById("onboard-note");
        if (note) note.textContent = "Введите имя, чтобы создать профиль.";
      });
      return;
    }
    const height = parseFloat(onboardingDraft.height);
    const weight = parseFloat(onboardingDraft.weight);
    const measurements = {};
    for (const [key, raw] of Object.entries(onboardingDraft.measurements || {})) {
      const v = parseFloat(raw);
      if (isFinite(v)) measurements[key] = Math.round(v * 10) / 10;
    }
    const st = store.get();
    const profile = {
      name: onboardingDraft.name,
      height: isFinite(height) ? Math.round(height * 10) / 10 : null,
      weight: isFinite(weight) ? Math.round(weight * 10) / 10 : null,
      photo: onboardingDraft.photo || "",
      measurements,
    };
    st.settings.profile = profile;
    if (profile.weight != null && !(st.weighIns || []).some((w) => w.date === currentDay)) {
      st.weighIns.push({ date: currentDay, weight: profile.weight });
    }
    if (Object.keys(measurements).length) {
      const list = ensureMeasurements(st);
      list.push({ date: currentDay, ...measurements });
    }
    try {
      if (Sync.isConfigured(syncCfg)) {
        const client = Sync.createSyncClient(syncCfg, window.fetch.bind(window));
        const created = await client.register(profile, st);
        syncCfg = { ...syncCfg, token: created.token };
        Sync.saveSyncConfig(window.localStorage, syncCfg);
        st.settings.profile = created.profile || profile;
      }
      saveState(st);
      await pushNow();
      onboardingDraft = null;
      onboardingStep = 0;
      renderToday();
    } catch (e) {
      st.settings.profile = profile;
      saveState(st);
      document.getElementById("onboard-note").textContent = "Профиль сохранён локально. Сервер не ответил, синхронизируем позже.";
      setTimeout(renderToday, 700);
    }
  };
  const next = document.getElementById("onboard-next");
  next.addEventListener("click", () => {
    collectStep();
    if (step === 0 && !onboardingDraft.name) {
      document.getElementById("onboard-note").textContent = "Введите имя, чтобы продолжить.";
      return;
    }
    if (step < 2) {
      onboardingStep = step + 1;
      renderOnboarding(store.get());
    } else finish();
  });
  const back = document.getElementById("onboard-back");
  if (back) back.addEventListener("click", () => {
    collectStep();
    onboardingStep = Math.max(0, step - 1);
    renderOnboarding(store.get());
  });
  const skip = document.getElementById("onboard-skip");
  if (skip) skip.addEventListener("click", () => {
    collectStep();
    if (step < 2) {
      onboardingStep = step + 1;
      renderOnboarding(store.get());
    } else finish();
  });
}

function renderProfileEditor() {
  const st = store.get();
  const profile = st.settings.profile || {};
  renderDetailShell({ title: "Аккаунт", sub: accountLabel(), accent: "workout", bodyId: "profile-detail" });
  document.getElementById("profile-detail").innerHTML = `
    <div class="detail-panel profile-panel">
      <div class="profile-photo-row">
        <div class="avatar big" id="profile-photo-preview">${profileAvatar(profile)}</div>
        <button class="btn ghost" id="profile-photo-btn">Сменить фото</button>
        <input type="file" id="profile-photo-file" accept="image/*" hidden>
      </div>
      <label class="onboard-field">Имя<input id="profile-name" value="${esc(profile.name || "")}"></label>
      <div class="onboard-grid">
        <label class="onboard-field">Рост<input id="profile-height" type="number" inputmode="decimal" value="${esc(profile.height || "")}" placeholder="см"></label>
        <label class="onboard-field">Вес<input id="profile-weight" type="number" step="0.1" inputmode="decimal" value="${esc(profile.weight || "")}" placeholder="кг"></label>
      </div>
      <button class="btn" id="profile-save">Сохранить</button>
    </div>`;
  let photo = profile.photo || "";
  document.getElementById("profile-photo-btn").addEventListener("click", () => document.getElementById("profile-photo-file").click());
  document.getElementById("profile-photo-file").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      photo = await readImageDataUrl(file, 512, 0.84);
      document.getElementById("profile-photo-preview").innerHTML = `<img src="${esc(photo)}" alt="">`;
    } catch {
      alert("Не удалось обработать фото");
    }
  });
  document.getElementById("profile-save").addEventListener("click", () => {
    const next = store.get();
    const height = parseFloat(document.getElementById("profile-height").value);
    const weight = parseFloat(document.getElementById("profile-weight").value);
    next.settings.profile = {
      ...(next.settings.profile || {}),
      name: document.getElementById("profile-name").value.trim() || "Профиль",
      height: isFinite(height) ? Math.round(height * 10) / 10 : null,
      weight: isFinite(weight) ? Math.round(weight * 10) / 10 : null,
      photo,
    };
    try {
      saveState(next);
      renderToday();
    } catch (e) {
      alert("Не удалось сохранить профиль. Попробуй фото поменьше.");
    }
  });
}

function ensureMeasurements(state) {
  if (!Array.isArray(state.measurements)) state.measurements = [];
  return state.measurements;
}

function measurementForDate(state, iso) {
  return ensureMeasurements(state).find((m) => m.date === iso) || null;
}

function dayHasActivity(state, iso) {
  const d = state.days[iso];
  const hasWorkout = !!(d && (d.workouts || []).length);
  const hasHabit = !!(d && d.habits && Object.values(d.habits).some(Boolean));
  const hasNote = !!(d && (d.note || "").trim());
  const hasNutrition = !!(d && L.dayNutritionTotals(d).kcal);
  const hasWeight = (state.weighIns || []).some((w) => w.date === iso);
  const hasMeasurement = ensureMeasurements(state).some((m) => m.date === iso);
  return hasWorkout || hasHabit || hasNote || hasNutrition || hasWeight || hasMeasurement;
}

function dayActivityLevel(state, iso) {
  const d = state.days[iso] || {};
  let level = 0;
  if ((d.workouts || []).length) level += 1;
  if (d.habits && Object.values(d.habits).some(Boolean)) level += 1;
  if (L.dayNutritionTotals(d).kcal) level += 1;
  if ((state.weighIns || []).some((w) => w.date === iso)) level += 1;
  if (ensureMeasurements(state).some((m) => m.date === iso)) level += 1;
  return Math.min(3, level);
}

function calendarHtml(state, selectedISO) {
  const selected = L.parseISO(selectedISO);
  const monthStart = new Date(selected.getFullYear(), selected.getMonth(), 1);
  const firstGridDay = new Date(monthStart);
  const mondayOffset = (monthStart.getDay() + 6) % 7;
  firstGridDay.setDate(monthStart.getDate() - mondayOffset);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(firstGridDay);
    d.setDate(firstGridDay.getDate() + i);
    const iso = L.toISO(d);
    const inMonth = d.getMonth() === selected.getMonth();
    const level = dayActivityLevel(state, iso);
    cells.push(`<button class="day-cell ${inMonth ? "" : "muted"} ${iso === selectedISO ? "selected" : ""} ${level ? `active level-${level}` : ""}" data-cal-day="${iso}">
      <span>${d.getDate()}</span>
    </button>`);
  }
  return `<div class="calendar-overlay">
  <div class="calendar-card card">
    <div class="calendar-head">
      <button class="navbtn small" id="cal-prev" aria-label="Предыдущий месяц">${ICON.chevL}</button>
      <div class="calendar-title">${MONTHS[selected.getMonth()]} ${selected.getFullYear()}</div>
      <button class="navbtn small" id="cal-next" aria-label="Следующий месяц">${ICON.chevR}</button>
      <button class="calendar-close" id="cal-close" aria-label="Закрыть">${ICON.x}</button>
    </div>
    <div class="calendar-weekdays">${["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => `<span>${d}</span>`).join("")}</div>
    <div class="calendar-grid">${cells.join("")}</div>
  </div></div>`;
}

function shiftCalendarMonth(delta) {
  const d = L.parseISO(currentDay);
  d.setMonth(d.getMonth() + delta, 1);
  currentDay = L.toISO(d);
  calendarOpen = true;
  renderToday();
}

function wireDayCalendar() {
  if (!calendarOpen) return;
  const prev = document.getElementById("cal-prev");
  const next = document.getElementById("cal-next");
  if (prev) prev.addEventListener("click", () => shiftCalendarMonth(-1));
  if (next) next.addEventListener("click", () => shiftCalendarMonth(1));
  const close = document.getElementById("cal-close");
  if (close) close.addEventListener("click", () => {
    calendarOpen = false;
    renderToday();
  });
  document.querySelectorAll("[data-cal-day]").forEach((btn) =>
    btn.addEventListener("click", () => {
      currentDay = btn.dataset.calDay;
      calendarOpen = false;
      todayRoute = "main";
      renderToday();
    })
  );
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

function setWeightAt(workout, index) {
  if (Array.isArray(workout.setWeights) && workout.setWeights[index] != null) {
    const v = Number(workout.setWeights[index]);
    return isFinite(v) ? Math.round(v * 10) / 10 : null;
  }
  if (workout.weight != null) {
    const v = Number(workout.weight);
    return isFinite(v) ? Math.round(v * 10) / 10 : null;
  }
  return null;
}

function hasWorkoutWeights(workout) {
  if (!workout || workout.type !== "reps") return false;
  if (workout.weightEnabled) return true;
  if (workout.weight != null && workout.weight !== "") return true;
  return Array.isArray(workout.setWeights) && workout.setWeights.some((v) => v != null && v !== "");
}

function latestWorkoutWeight(workout) {
  if (Array.isArray(workout.setWeights)) {
    for (let i = workout.setWeights.length - 1; i >= 0; i--) {
      const v = setWeightAt(workout, i);
      if (v != null) return v;
    }
  }
  return setWeightAt(workout, 0);
}

function lastWorkoutBefore(state, workout, beforeISO) {
  const id = workout.exerciseId;
  const key = exerciseKey(workout.name);
  return Object.keys(state.days || {})
    .filter((iso) => iso < beforeISO)
    .sort()
    .reverse()
    .flatMap((iso) => ((state.days[iso] && state.days[iso].workouts) || []).map((w) => ({ ...w, date: iso })))
    .find((w) => w.type === workout.type && ((id && w.exerciseId === id) || exerciseKey(w.name) === key));
}

function workoutCollapseKey(index) {
  return `${currentDay}:${index}`;
}

function workoutSummary(wk) {
  if (wk.type === "cardio") return (wk.value || "").trim() || "кардио";
  const sets = wk.sets || [];
  const total = sumSets(sets);
  const weights = sets.map((_, i) => setWeightAt(wk, i)).filter((v) => v != null);
  const maxWeight = weights.length ? Math.max(...weights) : null;
  const setLine = sets.length ? sets.join("-") : "—";
  return `${setLine} · ${total} повт.${maxWeight != null ? ` · ${maxWeight} кг` : ""}`;
}

function renameExerciseInState(state, exerciseId, nextName) {
  const ex = state.exercises.find((item) => item.id === exerciseId);
  if (!ex) return;
  const oldName = ex.name;
  ex.name = nextName;
  for (const day of Object.values(state.days || {})) {
    for (const wk of day.workouts || []) {
      if (wk.exerciseId === exerciseId || (!wk.exerciseId && sameName(wk.name, oldName))) {
        wk.exerciseId = exerciseId;
        wk.name = nextName;
      }
    }
  }
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

function renderMeasurements() {
  const s = store.get();
  const current = measurementForDate(s, currentDay);
  const values = MEASUREMENT_FIELDS.map((f) => ({
    ...f,
    value: current && current[f.key] != null ? current[f.key] : L.lastMeasurementValue(ensureMeasurements(s), f.key, currentDay),
    todayValue: current && current[f.key] != null ? current[f.key] : "",
  }));
  const rows = values
    .map(
      (f) => `<label class="measure-field">
        <span>${f.name}</span>
        <input data-measure="${f.key}" type="number" step="0.1" inputmode="decimal" placeholder="${f.value != null ? esc(f.value) : "—"}" value="${esc(f.todayValue)}" />
        <em>см</em>
      </label>`
    )
    .join("");

  document.getElementById("today-measurements").innerHTML = `
    <div class="card measurements-card">
      <div class="section-head"><div class="title">Замеры</div><div class="measure-date">${dayMonth(currentDay)}</div></div>
      <div class="measure-grid">${rows}</div>
    </div>`;

  document.querySelectorAll("[data-measure]").forEach((inp) =>
    inp.addEventListener("change", () => {
      const st = store.get();
      const list = ensureMeasurements(st);
      let row = list.find((m) => m.date === currentDay);
      if (!row) {
        row = { date: currentDay };
        list.push(row);
      }
      const key = inp.dataset.measure;
      const raw = inp.value.trim().replace(",", ".");
      if (!raw) delete row[key];
      else {
        const val = Math.round(parseFloat(raw) * 10) / 10;
        if (!isFinite(val)) return;
        row[key] = val;
        inp.value = val;
      }
      if (MEASUREMENT_FIELDS.every((f) => row[f.key] == null)) {
        const idx = list.indexOf(row);
        if (idx >= 0) list.splice(idx, 1);
      }
      saveState(st);
      renderMeasurements();
    })
  );
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
  const menuExercise = chipMenuExerciseId ? s.exercises.find((e) => e.id === chipMenuExerciseId) : null;
  const customForm = customExerciseOpen
    ? `<div class="custom-ex-form">
        <input id="custom-ex-name" autocomplete="off" placeholder="Новое упражнение" />
        <button class="chip add" id="save-custom-ex" aria-label="Добавить упражнение">${ICON.plus}</button>
        <button class="chip close" id="close-custom-ex" aria-label="Закрыть">${ICON.x}</button>
      </div>`
    : `<button class="chip add" id="add-custom">${ICON.plus} своё</button>`;
  const chips =
    uniqueExercises(s.exercises)
      .map((e) => `<button class="chip" data-add-ex="${esc(e.id)}">${esc(e.name)}</button>`)
      .join("") + customForm;
  const chipMenu = menuExercise
    ? `<div class="chip-menu">
        ${
          chipRenameOpen
            ? `<input id="rename-ex-name" value="${esc(menuExercise.name)}" autocomplete="off" />
               <button class="chip-menu-btn primary" id="rename-ex-save">Готово</button>
               <button class="chip-menu-btn" id="rename-ex-cancel">Отмена</button>`
            : `<div class="chip-menu-title">${esc(menuExercise.name)}</div>
               <button class="chip-menu-btn" id="rename-ex-open">Переименовать</button>
               <button class="chip-menu-btn danger" id="delete-ex-chip">Удалить</button>`
        }
      </div>`
    : "";

  const blocks = workouts
    .map((wk, i) => {
      const collapsed = collapsedWorkouts.has(workoutCollapseKey(i));
      const collapseIcon = ICON.chevR;
      if (wk.type === "cardio") {
        return `<div class="ex-block">
          <div class="ex-head">
            <button class="ex-collapse" data-toggle-wk="${i}" aria-label="${collapsed ? "Развернуть" : "Свернуть"}">
              <span class="ex-name">${esc(wk.name)}</span>
              <span class="ex-summary">${esc(workoutSummary(wk))}</span>
              <span class="ex-caret ${collapsed ? "" : "open"}">${collapseIcon}</span>
            </button>
            <button class="ex-del" data-del-wk="${i}">${ICON.x}</button>
          </div>
          ${collapsed ? "" : `<input class="cardio-input" data-wk="${i}" value="${esc(wk.value || "")}" placeholder="5 км / 30 мин" />`}
        </div>`;
      }
      const rows = (wk.sets || [])
        .map(
          (r, si) => {
            const weightEnabled = hasWorkoutWeights(wk);
            const setWeight = setWeightAt(wk, si);
            return `<div class="set-swipe" data-swipe-row>
            <button class="set-delete" data-delset-wk="${i}" data-delset="${si}">${ICON.trash}<span>Удалить</span></button>
            <div class="set-row" data-swipe-content>
              <div class="set-main ${weightEnabled ? "with-weight" : ""}">
                <span class="set-idx">${si + 1}</span>
                <div class="reps-control">
                  <button class="step minus" data-wk="${i}" data-set="${si}" data-d="-1" aria-label="Уменьшить повторы">−</button>
                  <input class="reps-input" id="val-${i}-${si}" data-wk="${i}" data-set="${si}" type="number" inputmode="numeric" min="0" value="${r}" aria-label="Повторы в подходе ${si + 1}" />
                  <button class="step plus" data-wk="${i}" data-set="${si}" data-d="1" aria-label="Увеличить повторы">+</button>
                </div>
                ${weightEnabled ? `<span class="set-times">×</span>
                  <label class="set-weight-chip">
                    <input data-set-weight-wk="${i}" data-set-weight="${si}" type="number" step="0.5" inputmode="decimal" placeholder="кг" value="${setWeight != null ? esc(setWeight) : ""}" aria-label="Вес в подходе ${si + 1}" />
                    <span>кг</span>
                  </label>` : ""}
              </div>
            </div></div>`;
          }
        )
        .join("");
      const weightEnabled = hasWorkoutWeights(wk);
      return `<div class="ex-block">
        <div class="ex-head">
          <button class="ex-collapse" data-toggle-wk="${i}" aria-label="${collapsed ? "Развернуть" : "Свернуть"}">
            <span class="ex-name">${esc(wk.name)}</span>
            <span class="ex-summary">${esc(workoutSummary(wk))}</span>
            <span class="ex-caret ${collapsed ? "" : "open"}">${collapseIcon}</span>
          </button>
          <button class="ex-del" data-del-wk="${i}">${ICON.x}</button>
        </div>
        ${
          collapsed
            ? ""
            : `<div class="ex-tools">
                <button class="weight-switch ${weightEnabled ? "active" : ""}" data-toggle-weight="${i}" role="switch" aria-checked="${weightEnabled ? "true" : "false"}">
                  <span class="switch-track"><span class="switch-knob"></span></span>
                  <span>С весом</span>
                </button>
              </div>
              <div class="set-rows">${rows}</div>
              <button class="add-set" data-addset="${i}">+ подход</button>
              <div class="ex-total">Всего: <b id="total-${i}">${sumSets(wk.sets)}</b></div>`
        }
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
      ${chipMenu}
    </div>
    ${blocks || `<div class="detail-panel"><div class="empty-hint">Нажми упражнение выше, чтобы записать подходы.</div></div>`}
  `;

  wireWorkoutEvents();
}

function wireWorkoutEvents() {
  document.querySelectorAll("[data-add-ex]").forEach((b) => {
    let pressTimer = null;
    const openMenu = (e) => {
      if (e) e.preventDefault();
      b.dataset.longPress = "1";
      chipMenuExerciseId = b.dataset.addEx;
      chipRenameOpen = false;
      customExerciseOpen = false;
      renderWorkoutDetail();
    };
    b.addEventListener("pointerdown", () => {
      b.dataset.longPress = "";
      pressTimer = setTimeout(openMenu, 520);
    });
    b.addEventListener("pointerup", () => clearTimeout(pressTimer));
    b.addEventListener("pointerleave", () => clearTimeout(pressTimer));
    b.addEventListener("contextmenu", openMenu);
    b.addEventListener("click", () => {
      if (b.dataset.longPress === "1") {
        b.dataset.longPress = "";
        return;
      }
      const s = store.get();
      const ex = s.exercises.find((e) => e.id === b.dataset.addEx);
      const day = getDay(s, currentDay);
      if (!day.workouts) day.workouts = [];
      day.workouts.push(
        ex.type === "cardio"
          ? { exerciseId: ex.id, name: ex.name, type: "cardio", value: "" }
          : { exerciseId: ex.id, name: ex.name, type: "reps", sets: [0] }
      );
      saveState(s);
      chipMenuExerciseId = null;
      chipRenameOpen = false;
      renderWorkoutDetail();
    });
  });

  document.querySelectorAll("[data-toggle-wk]").forEach((b) =>
    b.addEventListener("click", () => {
      const key = workoutCollapseKey(+b.dataset.toggleWk);
      if (collapsedWorkouts.has(key)) collapsedWorkouts.delete(key);
      else collapsedWorkouts.add(key);
      renderWorkoutDetail();
    })
  );

  document.querySelectorAll("[data-toggle-weight]").forEach((b) =>
    b.addEventListener("click", () => {
      const s = store.get();
      const workout = getDay(s, currentDay).workouts[+b.dataset.toggleWeight];
      if (!workout) return;
      const next = !hasWorkoutWeights(workout);
      workout.weightEnabled = next;
      if (next && !Array.isArray(workout.setWeights)) workout.setWeights = [];
      if (!next) {
        workout.setWeights = [];
        delete workout.weight;
      }
      saveState(s);
      renderWorkoutDetail();
    })
  );

  const renameOpen = document.getElementById("rename-ex-open");
  if (renameOpen) renameOpen.addEventListener("click", () => {
    chipRenameOpen = true;
    renderWorkoutDetail();
  });
  const renameCancel = document.getElementById("rename-ex-cancel");
  if (renameCancel) renameCancel.addEventListener("click", () => {
    chipRenameOpen = false;
    renderWorkoutDetail();
  });
  const renameSave = document.getElementById("rename-ex-save");
  if (renameSave) renameSave.addEventListener("click", () => {
    const input = document.getElementById("rename-ex-name");
    const name = input ? input.value.trim() : "";
    if (!name || !chipMenuExerciseId) return;
    const st = store.get();
    renameExerciseInState(st, chipMenuExerciseId, cleanExerciseName(name));
    saveState(st);
    chipRenameOpen = false;
    chipMenuExerciseId = null;
    renderWorkoutDetail();
  });
  const renameInput = document.getElementById("rename-ex-name");
  if (renameInput) {
    renameInput.focus();
    renameInput.select();
    renameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const btn = document.getElementById("rename-ex-save");
        if (btn) btn.click();
      }
      if (e.key === "Escape") {
        chipRenameOpen = false;
        renderWorkoutDetail();
      }
    });
  }
  const deleteChip = document.getElementById("delete-ex-chip");
  if (deleteChip) deleteChip.addEventListener("click", () => {
    if (!chipMenuExerciseId) return;
    const st = store.get();
    st.exercises = st.exercises.filter((e) => e.id !== chipMenuExerciseId);
    saveState(st);
    chipMenuExerciseId = null;
    chipRenameOpen = false;
    renderWorkoutDetail();
  });

  const addCustom = document.getElementById("add-custom");
  if (addCustom) addCustom.addEventListener("click", () => {
    customExerciseOpen = true;
    chipMenuExerciseId = null;
    chipRenameOpen = false;
    renderWorkoutDetail();
  });
  const closeCustom = document.getElementById("close-custom-ex");
  if (closeCustom) closeCustom.addEventListener("click", () => {
    customExerciseOpen = false;
    renderWorkoutDetail();
  });
  const saveCustom = document.getElementById("save-custom-ex");
  if (saveCustom) saveCustom.addEventListener("click", () => {
    const input = document.getElementById("custom-ex-name");
    const name = input ? input.value.trim() : "";
    if (!name) return;
    const s = store.get();
    const cleanName = cleanExerciseName(name);
    let ex = s.exercises.find((item) => sameName(item.name, cleanName));
    if (!ex) {
      ex = { id: normalizeId(cleanName, s.exercises), name: cleanName, type: "reps", preset: false };
      s.exercises.push(ex);
    }
    const day = getDay(s, currentDay);
    if (!day.workouts) day.workouts = [];
    day.workouts.push(
      ex.type === "cardio"
        ? { exerciseId: ex.id, name: ex.name, type: "cardio", value: "" }
        : { exerciseId: ex.id, name: ex.name, type: "reps", sets: [0], setWeights: [] }
    );
    saveState(s);
    customExerciseOpen = false;
    renderWorkoutDetail();
  });
  const customInput = document.getElementById("custom-ex-name");
  if (customInput) {
    customInput.focus();
    customInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const btn = document.getElementById("save-custom-ex");
        if (btn) btn.click();
      }
      if (e.key === "Escape") {
        customExerciseOpen = false;
        renderWorkoutDetail();
      }
    });
  }

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
      const workout = getDay(s, currentDay).workouts[+b.dataset.addset];
      const sets = workout.sets;
      sets.push(sets.length ? sets[sets.length - 1] : 0); // копируем прошлый подход
      if (hasWorkoutWeights(workout)) {
        if (!Array.isArray(workout.setWeights)) workout.setWeights = [];
        const prev = setWeightAt(workout, sets.length - 2);
        workout.setWeights.push(prev != null ? prev : null);
      }
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

  document.querySelectorAll("input[data-set-weight]").forEach((inp) =>
    inp.addEventListener("change", () => {
      const s = store.get();
      const workout = getDay(s, currentDay).workouts[+inp.dataset.setWeightWk];
      const setIndex = +inp.dataset.setWeight;
      const raw = inp.value.trim().replace(",", ".");
      if (!Array.isArray(workout.setWeights)) workout.setWeights = [];
      if (!raw) delete workout.setWeights[setIndex];
      else {
        const weight = parseFloat(raw);
        if (!isFinite(weight)) return;
        workout.setWeights[setIndex] = Math.round(weight * 10) / 10;
        inp.value = weight;
      }
      saveState(s);
      renderWorkoutDetail();
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
      if (Array.isArray(workout.setWeights)) workout.setWeights.splice(+b.dataset.delset, 1);
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

function statsWindowSize() {
  return statsRange === "week" ? 7 : 30;
}

function statsEndISO() {
  return statsEndDay || todayISO();
}

function shiftStatsWindow(delta) {
  const next = L.addDays(statsEndISO(), delta * statsWindowSize());
  statsEndDay = next > todayISO() ? todayISO() : next;
  renderStats();
}

function statsPeriodLabel(dates) {
  const first = dates[0];
  const last = dates[dates.length - 1];
  return first === last ? shortDate(last) : `${dayMonth(first)} — ${shortDate(last)}`;
}

function chartDayLabel(iso, range) {
  const d = L.parseISO(iso);
  if (range === "week") return ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"][d.getDay()];
  return String(d.getDate());
}

function chartPointLabel(iso, dates) {
  if (statsRange === "week") return chartDayLabel(iso, statsRange);
  const i = dates.indexOf(iso);
  const d = L.parseISO(iso).getDate();
  return i === 0 || i === dates.length - 1 || d === 1 || d % 5 === 0 ? String(d) : "";
}

function workoutCountInRange(days, dates) {
  return dates.filter((iso) => days[iso] && (days[iso].workouts || []).length > 0).length;
}

function exercisePoints(days, exerciseKeyValue, dates) {
  return dates.map((date) => {
    const workouts = ((days[date] && days[date].workouts) || []).filter(
      (w) => w.type === "reps" && exerciseKey(w.name) === exerciseKeyValue
    );
    const value = workouts.reduce((a, w) => a + sumSets(w.sets), 0);
    const sets = workouts.reduce((a, w) => a + ((w.sets && w.sets.length) || 0), 0);
    const weighted = [...workouts].reverse().map(latestWorkoutWeight).find((w) => w != null);
    return {
      date,
      label: chartPointLabel(date, dates),
      value,
      sets,
      weight: weighted != null ? weighted : null,
    };
  });
}

function exerciseGroupsInState(days) {
  const groups = new Map();
  Object.values(days).forEach((d) => {
    (d.workouts || [])
      .filter((w) => w.type === "reps")
      .forEach((w) => {
        const key = exerciseKey(w.name);
        if (!key) return;
        if (!groups.has(key)) groups.set(key, { key, name: cleanExerciseName(w.name) });
      });
  });
  return [...groups.values()];
}

function percentDelta(current, previous) {
  if (!previous && !current) return 0;
  if (!previous) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function deltaClass(value) {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

function statTile(label, value, sub = "") {
  return `<div class="stat-tile"><span>${label}</span><b>${value}</b>${sub ? `<em>${sub}</em>` : ""}</div>`;
}

function nutritionPoints(days, dates) {
  return dates.map((date) => ({
    date,
    label: chartPointLabel(date, dates),
    ...L.dayNutritionTotals(days[date]),
  }));
}

function measurementPoints(measurements, field, dates) {
  const byDate = new Map((measurements || []).map((m) => [m.date, m]));
  return dates
    .map((date) => {
      const value = byDate.get(date) && byDate.get(date)[field.key];
      return value == null ? null : { date, label: chartPointLabel(date, dates), value };
    })
    .filter(Boolean);
}

function habitHeatmapHtml(state, dates) {
  if (!state.habits.length) return "";
  const rows = state.habits
    .map((h) => {
      const doneCount = dates.filter((iso) => state.days[iso] && state.days[iso].habits && state.days[iso].habits[h.id]).length;
      const cells = dates
        .map((iso) => {
          const done = state.days[iso] && state.days[iso].habits && state.days[iso].habits[h.id];
          return `<span class="heat-cell ${done ? "on" : ""}" title="${esc(h.name)} · ${shortDate(iso)}"></span>`;
        })
        .join("");
      return `<div class="heat-row">
        <div class="heat-name"><span>${esc(h.name)}</span><b>${doneCount}/${dates.length}</b></div>
        <div class="heat-cells" style="--heat-count:${dates.length}">${cells}</div>
      </div>`;
    })
    .join("");
  return `<section class="card stat-card habit-stat">
    <div class="stat-card-head">
      <div class="title">Привычки</div>
      <div class="stat-pill" style="--pill-color:var(--green)">heatmap</div>
    </div>
    <div class="habit-heatmap">${rows}</div>
  </section>`;
}

function renderStats() {
  const s = store.get();
  const count = statsWindowSize();
  const endDay = statsEndISO();
  const dates = rangeDays(endDay, count);
  const previousDates = rangeDays(L.addDays(dates[0], -1), count);
  const totalWorkouts = workoutCountInRange(s.days, dates);
  const previousWorkouts = workoutCountInRange(s.days, previousDates);
  const workoutDelta = totalWorkouts - previousWorkouts;
  const rangeLabel = statsRange === "week" ? "на этой неделе" : "за 30 дней";
  const prevLabel = statsRange === "week" ? "с прошлой неделей" : "с прошлым периодом";
  const colors = ["#58cc02", "#ff9a00", "#1d73e8", "#a560f0"];
  const measurementBlocks = MEASUREMENT_FIELDS.map((field, index) => {
    const points = measurementPoints(ensureMeasurements(s), field, dates);
    if (!points.length) return "";
    const color = colors[(index + 1) % colors.length];
    const latest = points[points.length - 1];
    return `<section class="card stat-card measurement-stat">
      <div class="stat-card-head">
        <div class="title">${esc(field.name)}</div>
        <div class="stat-pill" style="--pill-color:${color}">${latest.value} см</div>
      </div>
      ${Charts.lineChart(points, color)}
    </section>`;
  }).join("");

  const exGroups = exerciseGroupsInState(s.days);
  const exBlocks = exGroups
    .map((group, index) => {
      const points = exercisePoints(s.days, group.key, dates);
      const previous = exercisePoints(s.days, group.key, previousDates);
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
          <div class="title">${esc(group.name)}</div>
          <div class="stat-pill" style="--pill-color:${color}">Всего: ${total}</div>
        </div>
        ${Charts.barChart(points, color)}
        <div class="stat-micro" style="--progress-color:${color}">
          <span><b>${avg}</b> ср.</span>
          <span><b>${best.value}</b> ${best.label}</span>
          <span><b>${totalSets}</b> подх.</span>
          <span class="delta ${deltaClass(delta)}"><b>${delta > 0 ? "+" : ""}${delta}%</b></span>
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
      <h1>Прогресс</h1>
      <div class="segmented">
        <button class="${statsRange === "week" ? "active" : ""}" data-stats-range="week">Неделя</button>
        <button class="${statsRange === "month" ? "active" : ""}" data-stats-range="month">Месяц</button>
      </div>
    </div>
    <div class="stats-period">
      <button class="navbtn small" id="stats-prev" aria-label="Прошлый период">${ICON.chevL}</button>
      <div>${statsPeriodLabel(dates)}</div>
      <button class="navbtn small" id="stats-next" aria-label="Следующий период" ${endDay >= todayISO() ? "disabled" : ""}>${ICON.chevR}</button>
    </div>
    <section class="card stat-summary">
      <div>
        <div class="eyebrow">Всего тренировок</div>
        <div class="stat-big">${totalWorkouts}</div>
        <div class="muted-line">${rangeLabel}</div>
      </div>
      <div class="stat-compare">
        <b class="${deltaClass(workoutDelta)}">${workoutDelta > 0 ? "+" : ""}${workoutDelta}</b>
        <span>${prevLabel}</span>
      </div>
    </section>
    ${exBlocks}
    ${habitHeatmapHtml(s, dates)}
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
    ${measurementBlocks}
  `;
  document.querySelectorAll("[data-stats-range]").forEach((btn) =>
    btn.addEventListener("click", () => {
      statsRange = btn.dataset.statsRange;
      statsEndDay = todayISO();
      renderStats();
    })
  );
  document.getElementById("stats-prev").addEventListener("click", () => shiftStatsWindow(-1));
  document.getElementById("stats-next").addEventListener("click", () => {
    if (statsEndISO() >= todayISO()) return;
    shiftStatsWindow(1);
  });
  wireStatsSwipe();
}

function wireStatsSwipe() {
  document.querySelectorAll(".exercise-stat").forEach((card) => {
    let startX = 0, startY = 0, dx = 0;
    card.addEventListener("touchstart", (e) => {
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      dx = 0;
    }, { passive: true });
    card.addEventListener("touchmove", (e) => {
      const t = e.touches[0];
      dx = t.clientX - startX;
    }, { passive: true });
    card.addEventListener("touchend", (e) => {
      const dy = Math.abs((e.changedTouches[0] && e.changedTouches[0].clientY) - startY);
      if (Math.abs(dx) < 56 || dy > Math.abs(dx) * 0.8) return;
      if (dx < 0 && statsEndISO() < todayISO()) shiftStatsWindow(1);
      if (dx > 0) shiftStatsWindow(-1);
    });
  });
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
function renderCounterSettings(counters) {
  return (counters || [])
    .map((c, i) => `<div class="edit-row counter-edit">
      <input data-counter-name="${i}" value="${esc(c.name)}" placeholder="Название">
      <input data-counter-date="${i}" type="date" value="${esc(c.startDate)}">
      <button class="icon-x" data-del-counter="${i}" aria-label="Удалить счётчик">${ICON.x}</button>
    </div>`)
    .join("");
}

function renderSettings() {
  const s = store.get();
  if (!Array.isArray(s.settings.counters)) s.settings.counters = [];
  if (!s.settings.challenge) s.settings.challenge = { enabled: false, startDate: todayISO(), anchorDate: todayISO(), remainingAtAnchor: 75, targetDays: 75, photoUrl: "" };
  const ch = s.settings.challenge;
  screens.settings.innerHTML = `
    <h1>Настройки</h1>
    <div class="card">
      <div class="eyebrow">Карточки-счётчики</div>
      <div id="counter-list">${renderCounterSettings(s.settings.counters)}</div>
      <button class="btn ghost" id="add-counter">Добавить счётчик</button>
    </div>
    <div class="card">
      <div class="eyebrow">Челлендж</div>
      <label class="field toggle-field">Участвовать
        <input type="checkbox" id="set-ch-enabled" ${ch.enabled ? "checked" : ""}>
      </label>
      <div class="field">Старт (день 1)<input type="date" id="set-ch-start" value="${esc(ch.startDate || todayISO())}"></div>
      <div class="field">Якорь отсчёта<input type="date" id="set-ch-anchor" value="${esc(ch.anchorDate || todayISO())}"></div>
      <div class="field">Остаток на якоре<input type="number" id="set-ch-rem" value="${esc(ch.remainingAtAnchor || 75)}"></div>
      <div class="field">Дней всего<input type="number" id="set-ch-target" value="${esc(ch.targetDays || 75)}"></div>
      <div class="field">Фото фона<input type="url" id="set-ch-photo" value="${esc(ch.photoUrl || "")}" placeholder="https://... или выбери файл"></div>
      <button class="btn ghost" id="set-ch-photo-file">Выбрать фото</button>
      <input type="file" id="ch-photo-file" accept="image/*" hidden>
    </div>
    <div class="card">
      <div class="eyebrow">Взвешивание</div>
      <div class="field">Взвешивание: якорь<input type="date" id="set-w-anchor" value="${s.settings.weighIn.anchorDate}"></div>
      <div class="field">Взвешивание: интервал, дней<input type="number" id="set-w-int" value="${s.settings.weighIn.intervalDays}"></div>
      <button class="btn" id="save-settings">Сохранить</button>
    </div>
    <div class="card"><div class="eyebrow">Упражнения</div><div id="ex-list"></div>
      <button class="btn ghost" id="add-ex-preset">Добавить упражнение</button></div>
    <div class="card"><div class="eyebrow">Привычки</div><div id="habit-list"></div>
      <button class="btn ghost" id="add-habit">Добавить привычку</button></div>
    <div class="card"><div class="eyebrow">Замеры веса</div><div id="weigh-list"></div>
      <button class="btn ghost" id="add-weigh">Добавить замер</button></div>
    <div class="app-version">Версия ${APP_VERSION}</div>
  `;
  wireSettings();
}

function wireSettings() {
  const today = todayISO();
  document.getElementById("save-settings").addEventListener("click", () => {
    const s = store.get();
    s.settings.counters = [...document.querySelectorAll("[data-counter-name]")]
      .map((inp) => {
        const i = +inp.dataset.counterName;
        const startDate = document.querySelector(`[data-counter-date="${i}"]`).value;
        return { ...(s.settings.counters[i] || {}), id: (s.settings.counters[i] && s.settings.counters[i].id) || normalizeId(inp.value, s.settings.counters), name: inp.value.trim(), startDate, tone: (s.settings.counters[i] && s.settings.counters[i].tone) || (i % 2 ? "spray" : "alco") };
      })
      .filter((c) => c.name && c.startDate);
    s.settings.noAlcoholStart = (s.settings.counters.find((c) => c.id === "no-alcohol") || {}).startDate || s.settings.noAlcoholStart;
    s.settings.noSpraysStart = (s.settings.counters.find((c) => c.id === "no-sprays") || {}).startDate || s.settings.noSpraysStart;
    s.settings.challenge.enabled = document.getElementById("set-ch-enabled").checked;
    s.settings.challenge.startDate = document.getElementById("set-ch-start").value;
    s.settings.challenge.anchorDate = document.getElementById("set-ch-anchor").value;
    s.settings.challenge.remainingAtAnchor = parseInt(document.getElementById("set-ch-rem").value, 10);
    s.settings.challenge.targetDays = parseInt(document.getElementById("set-ch-target").value, 10) || 75;
    s.settings.challenge.photoUrl = document.getElementById("set-ch-photo").value.trim();
    s.settings.weighIn.anchorDate = document.getElementById("set-w-anchor").value;
    s.settings.weighIn.intervalDays = parseInt(document.getElementById("set-w-int").value, 10);
    saveState(s);
    alert("Сохранено");
  });
  document.getElementById("add-counter").addEventListener("click", () => {
    const s = store.get();
    s.settings.counters.push({ id: normalizeId("counter", s.settings.counters), name: "Новый счётчик", startDate: today, tone: s.settings.counters.length % 2 ? "spray" : "alco" });
    saveState(s);
    renderSettings();
  });
  document.querySelectorAll("[data-del-counter]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const s = store.get();
      s.settings.counters.splice(+btn.dataset.delCounter, 1);
      saveState(s);
      renderSettings();
    })
  );
  document.getElementById("set-ch-photo-file").addEventListener("click", () => document.getElementById("ch-photo-file").click());
  document.getElementById("ch-photo-file").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      document.getElementById("set-ch-photo").value = await readImageDataUrl(file, 1200, 0.78);
    } catch {
      alert("Не удалось обработать фото");
    }
  });

  renderEditableList("ex-list", "exercises", "add-ex-preset");
  renderEditableList("habit-list", "habits", "add-habit");
  renderWeighList();

  const exportBtn = document.getElementById("export");
  if (exportBtn) exportBtn.addEventListener("click", exportData);
  const serverBackupBtn = document.getElementById("server-backup");
  if (serverBackupBtn) serverBackupBtn.addEventListener("click", async () => {
    if (!Sync.isConfigured(syncCfg)) {
      alert("Сначала подключи синхронизацию.");
      return;
    }
    try {
      const res = await fetch(syncApiBase() + "/backup", {
        method: "POST",
        headers: { Authorization: `Bearer ${syncCfg.token}` },
      });
      if (!res.ok) throw new Error(String(res.status));
      const body = await res.json();
      alert(body.path ? `Бэкап создан: ${body.path}` : "Бэкап создан");
    } catch {
      alert("Не удалось создать серверный бэкап. Нужен admin token.");
    }
  });
  const importBtn = document.getElementById("import");
  if (importBtn) importBtn.addEventListener("click", () => document.getElementById("import-file").click());
  const importFile = document.getElementById("import-file");
  if (importFile) importFile.addEventListener("change", importData);

  const syncSave = document.getElementById("sync-save");
  if (syncSave) syncSave.addEventListener("click", async () => {
    syncCfg = {
      apiUrl: document.getElementById("sync-url").value.trim(),
      token: document.getElementById("sync-token").value.trim(),
    };
    Sync.saveSyncConfig(window.localStorage, syncCfg);
    await pullOnStart();
    renderSettings();
  });
  const syncNow = document.getElementById("sync-now");
  if (syncNow) syncNow.addEventListener("click", async () => {
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
      const nextName = inp.dataset.key === "exercises" ? cleanExerciseName(inp.value) : inp.value.trim();
      if (!nextName) return;
      st[inp.dataset.key][+inp.dataset.i].name = nextName;
      saveState(st);
      renderSettings();
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
    if (key === "exercises") {
      const cleanName = cleanExerciseName(name);
      if (st.exercises.some((item) => sameName(item.name, cleanName))) return;
      st.exercises.push({ id: normalizeId(cleanName, st.exercises), name: cleanName, type: "reps", preset: false });
    } else {
      const cleanName = name.trim();
      if (!cleanName) return;
      st.habits.push({ id: normalizeId(cleanName, st[key]), name: cleanName });
    }
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
