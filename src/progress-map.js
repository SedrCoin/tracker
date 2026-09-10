import { addDays } from "./logic.js";
import { SUMMIT_COLORS } from "./progress-art.js";
import { MAX_PHRASE_LENGTH, PHRASE_BACKGROUND, DEFAULT_PHRASES, validateMapPhrase, phraseArtwork } from "./map-phrases.js?v=20260910-04";

export const MAP_SIZE = 20;
export const MAP_CELLS = MAP_SIZE * MAP_SIZE;
export const MAP_SIZES = [12, 20, 28];
const resolveSize = (value) => MAP_SIZES.includes(Number(value)) ? Number(value) : MAP_SIZE;
const PREFS_KEY = "tracker.progress-map.v1";
const MAX = Number.MAX_SAFE_INTEGER;
const positiveInteger = (value) => {
  const number = typeof value === "number" || typeof value === "string" ? Number(value) : 0;
  return Number.isFinite(number) ? Math.min(MAX, Math.max(0, Math.floor(number))) : 0;
};
const cleanName = (value) => String(value || "").replace(/[«»"']/g, "").replace(/\s+/g, " ").trim();
const nameKey = (value) => cleanName(value).toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/gi, "");
const isPastDate = (date, today) => /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today;

// Always derive progress from the source records. Editing, importing or syncing a
// workout must not award the same cells twice or leave deleted repetitions behind.
export function collectMapSources(state = {}, today) {
  const exercises = new Map();
  const habits = new Map();
  const ensureExercise = (exercise) => {
    const key = nameKey(exercise?.name);
    if (!key) return null;
    const kind = exercise.type === "cardio" ? "sessions" : "reps";
    const id = `exercise:${kind}:${key}`;
    if (!exercises.has(id)) exercises.set(id, {
      id, name: cleanName(exercise.name), group: "Упражнения", kind,
      total: 0, cellsPerUnit: kind === "reps" ? 1 : 10,
    });
    return exercises.get(id);
  };
  for (const exercise of state.exercises || []) ensureExercise(exercise);
  for (const habit of state.habits || []) {
    if (habit?.id == null) continue;
    habits.set(String(habit.id), {
      id: `habit:${habit.id}`, name: cleanName(habit.name) || "Привычка",
      group: "Привычки", kind: "days", total: 0, cellsPerUnit: 10,
    });
  }
  for (const [date, day] of Object.entries(state.days || {})) {
    if (!isPastDate(date, today) || !day) continue;
    for (const workout of day.workouts || []) {
      if (!workout || !["reps", "cardio"].includes(workout.type)) continue;
      const source = ensureExercise(workout);
      if (!source) continue;
      const value = workout.type === "reps"
        ? (Array.isArray(workout.sets) ? workout.sets : []).reduce((sum, reps) => Math.min(MAX, sum + positiveInteger(reps)), 0)
        : (String(workout.value ?? "").trim() ? 1 : 0);
      source.total = Math.min(MAX, source.total + value);
    }
    for (const [id, done] of Object.entries(day.habits || {})) {
      if (done !== true) continue;
      if (!habits.has(id)) habits.set(id, {
        id: `habit:${id}`, name: `Привычка из архива (${id})`,
        group: "Привычки", kind: "days", total: 0, cellsPerUnit: 10,
      });
      habits.get(id).total += 1;
    }
  }
  const allReps = {
    id: "all-reps", name: "Все повторы", group: "Упражнения", kind: "reps",
    total: [...exercises.values()].filter((source) => source.kind === "reps").reduce((sum, source) => Math.min(MAX, sum + source.total), 0),
    cellsPerUnit: 1,
  };
  const challenges = (state.challenges || []).filter((challenge) => challenge?.id != null).map((challenge) => {
    const start = challenge.startDate || challenge.anchorDate;
    const duration = Math.min(36500, positiveInteger(challenge.durationDays || challenge.targetDays));
    const end = start && duration ? addDays(start, duration - 1) : today;
    const total = Object.entries(challenge.checks || {}).filter(([date, done]) =>
      done === true && isPastDate(date, today) && (!start || date >= start) && date <= end
    ).length;
    return { id: `challenge:${challenge.id}`, name: cleanName(challenge.name) || "Челлендж", group: "Челленджи", kind: "days", total, cellsPerUnit: 10 };
  });
  return [allReps, ...exercises.values(), ...habits.values(), ...challenges];
}

export function mapProgress(total, cellsPerUnit = 1, requestedPage = null, gridSize = MAP_SIZE) {
  const size = resolveSize(gridSize);
  const capacity = size * size;
  const multiplier = cellsPerUnit === 10 ? 10 : 1;
  const cells = Math.min(MAX, positiveInteger(total) * multiplier);
  const completed = Math.floor(cells / capacity);
  // Keep a just-completed picture visible until the next real action arrives.
  const currentPage = Math.max(0, Math.ceil(cells / capacity) - 1);
  const lastPage = completed;
  const page = requestedPage == null ? currentPage : Math.min(lastPage, positiveInteger(requestedPage));
  const filled = Math.max(0, Math.min(capacity, cells - page * capacity));
  return { size, capacity, cells, completed, currentPage, lastPage, page, filled, percent: Math.floor(filled / capacity * 100), remaining: Math.ceil((capacity - filled) / multiplier) };
}

function hash(value) {
  let result = 2166136261;
  for (const char of String(value)) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return result >>> 0;
}

// Breadth-first expansion keeps every new cell attached to the existing patch.
// A stable seed preserves the picture and filled positions on every reload.
export function mapRevealOrder(seed, gridSize = MAP_SIZE) {
  const size = resolveSize(gridSize);
  const number = hash(seed);
  const start = (Math.floor(size * .7) + number % Math.ceil(size * .15)) * size + Math.floor(size * .15) + (number >>> 4) % Math.ceil(size * .25);
  const order = [start];
  const seen = new Set(order);
  const directions = [[0, -1], [1, 0], [-1, 0], [0, 1]];
  const offset = number % directions.length;
  for (let i = 0; i < order.length; i += 1) {
    const x = order[i] % size, y = Math.floor(order[i] / size);
    for (let j = 0; j < directions.length; j += 1) {
      const [dx, dy] = directions[(j + offset) % directions.length];
      const nx = x + dx, ny = y + dy, next = ny * size + nx;
      if (nx < 0 || nx >= size || ny < 0 || ny >= size || seen.has(next)) continue;
      seen.add(next);
      order.push(next);
    }
  }
  return order;
}

export function mapArtwork(mode, page = 0, customPhrase = "", gridSize = MAP_SIZE) {
  const size = resolveSize(gridSize);
  if (mode === "text") {
    const custom = validateMapPhrase(customPhrase);
    const phrase = custom.valid ? custom.text : DEFAULT_PHRASES[positiveInteger(page) % DEFAULT_PHRASES.length];
    return { ...phraseArtwork(phrase), colors: new Array(size * size).fill(PHRASE_BACKGROUND) };
  }
  const colors = Array.from({ length: size * size }, (_, index) => {
    const x = Math.min(MAP_SIZE - 1, Math.floor(((index % size) + .5) * MAP_SIZE / size));
    const y = Math.min(MAP_SIZE - 1, Math.floor((Math.floor(index / size) + .5) * MAP_SIZE / size));
    return SUMMIT_COLORS[y * MAP_SIZE + x];
  });
  return { name: "Путь к вершине", colors };
}

function plural(number, forms) {
  const n = number % 100;
  return forms[n > 10 && n < 20 ? 2 : n % 10 === 1 ? 0 : n % 10 > 1 && n % 10 < 5 ? 1 : 2];
}
function units(value, kind) {
  const forms = kind === "reps" ? ["повтор", "повтора", "повторов"] : kind === "sessions" ? ["тренировка", "тренировки", "тренировок"] : ["день", "дня", "дней"];
  return `${value.toLocaleString("ru-RU")} ${plural(value, forms)}`;
}
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

export function createProgressMap(storage) {
  let preferences = {};
  try { preferences = JSON.parse(storage.getItem(PREFS_KEY)) || {}; } catch { /* Preferences are optional. */ }
  let sourceId = typeof preferences.sourceId === "string" ? preferences.sourceId : "all-reps";
  let mode = preferences.mode === "text" ? "text" : "picture";
  let gridSize = resolveSize(preferences.gridSize);
  const phrases = new Map(Object.entries(preferences.phrases && typeof preferences.phrases === "object" ? preferences.phrases : {})
    .filter(([, value]) => typeof value === "string" && validateMapPhrase(value).valid)
    .map(([key, value]) => [key, validateMapPhrase(value).text]));
  let editorOpen = false;
  const phraseDrafts = new Map();
  let selectedPage = null;
  const lastCounts = new Map();
  const savePreferences = () => {
    try { storage.setItem(PREFS_KEY, JSON.stringify({ sourceId, mode, gridSize, phrases: Object.fromEntries(phrases) })); return true; } catch { return false; }
  };

  return {
    render(host, state, today) {
      const sources = collectMapSources(state, today);
      const source = sources.find((item) => item.id === sourceId) || sources[0];
      sourceId = source.id;
      const previousCount = lastCounts.get(sourceId);
      if (previousCount != null && previousCount !== source.total) selectedPage = null;
      const progress = mapProgress(source.total, source.cellsPerUnit, selectedPage, gridSize);
      const capacity = progress.capacity;
      lastCounts.set(sourceId, source.total);
      const customPhrase = phrases.get(sourceId) || "";
      const phraseDraft = phraseDrafts.get(sourceId) ?? customPhrase;
      const artwork = mapArtwork(mode, progress.page, customPhrase, gridSize);
      const order = mapRevealOrder(`${source.id}:${progress.page}`, gridSize);
      const ranks = new Array(capacity);
      order.forEach((position, rank) => { ranks[position] = rank; });
      const hasNewProgress = previousCount != null && source.total > previousCount;
      const priorFilled = hasNewProgress
        ? Math.max(0, Math.min(capacity, previousCount * source.cellsPerUnit - progress.page * capacity))
        : progress.filled;
      const animationStart = Math.max(priorFilled, progress.filled - 80);
      const cells = artwork.colors.map((color, position) => {
        const rank = ranks[position];
        const revealed = rank < progress.filled;
        const fresh = hasNewProgress && revealed && rank >= animationStart;
        const x = (position % gridSize) / (gridSize - 1) * 100;
        const y = Math.floor(position / gridSize) / (gridSize - 1) * 100;
        // Each earned tile shows its exact patch of the original artwork. The
        // sampled palette remains an offline fallback and the phrase renderer.
        return `<span class="map-pixel${revealed ? " revealed" : ""}${fresh ? " fresh" : ""}"${revealed ? ` style="--pixel-color:${color};--tile-x:${x}%;--tile-y:${y}%;--pixel-delay:${Math.max(0, rank - animationStart) * 2}ms"` : ""}></span>`;
      }).join("");
      const groups = [...new Set(sources.map((item) => item.group))];
      const options = groups.map((group) => `<optgroup label="${group}">${sources.filter((item) => item.group === group).map((item) => `<option value="${escapeHtml(item.id)}"${item.id === sourceId ? " selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}</optgroup>`).join("");
      const unitCaption = source.kind === "reps" ? "1 повтор = 1 клетка" : source.kind === "sessions" ? "1 тренировка = 10 клеток" : "1 день = 10 клеток";
      const status = progress.filled === capacity
        ? `Открыто: ${artwork.name}`
        : source.total === 0
          ? "Запиши первое выполнение — появятся первые клетки."
          : `До раскрытия: ${units(progress.remaining, source.kind)}`;
      host.innerHTML = `
        <section class="progress-map" aria-label="Карта прогресса">
          <div class="map-source-heading"><label class="map-source-label" for="map-source">Что считаем</label><span>За всё время</span></div>
          <select id="map-source" class="map-source">${options}</select>
          <div class="map-total-row"><strong>${escapeHtml(units(source.total, source.kind))}</strong><span>${progress.completed} ${plural(progress.completed, ["карта открыта", "карты открыты", "карт открыто"])}</span></div>
          <div class="map-tools"><div><span class="map-tool-label">Вид карты</span><div class="map-art-switch" role="group" aria-label="Что скрыто в клетках"><button type="button" data-map-art="picture" aria-pressed="${mode === "picture"}">Рисунок</button><button type="button" data-map-art="text" aria-pressed="${mode === "text"}">Фраза</button></div></div><label class="map-size-label" for="map-cell-size"><span class="map-tool-label">Размер клеток</span><select id="map-cell-size">${MAP_SIZES.map((size, index) => `<option value="${size}"${size === gridSize ? " selected" : ""}>${["Крупные", "Средние", "Мелкие"][index]} · ${size}×${size}</option>`).join("")}</select></label></div>
          ${mode === "text" ? `<details class="map-phrase-editor"${editorOpen ? " open" : ""}><summary>Своя фраза<span>до ${MAX_PHRASE_LENGTH} символов</span></summary><form id="map-phrase-form" novalidate><label class="map-tool-label" for="map-phrase-input">Фраза для «${escapeHtml(source.name)}»</label><input id="map-phrase-input" type="text" value="${escapeHtml(phraseDraft)}" maxlength="120" placeholder="Например: Сильнее с каждым днём" autocomplete="off" aria-describedby="map-phrase-counter map-phrase-error" /><div class="map-phrase-meta"><span id="map-phrase-error" role="alert"></span><span id="map-phrase-counter">${Array.from(phraseDraft).length} / ${MAX_PHRASE_LENGTH}</span></div><div class="map-phrase-actions"><button type="submit" id="map-phrase-save" disabled>${customPhrase ? "Сохранено" : "Применить"}</button><button type="button" id="map-phrase-auto"${customPhrase ? "" : " disabled"}>Автофразы</button></div></form></details>` : ""}
          <div class="map-mosaic-frame"><div class="map-mosaic ${mode === "picture" ? "map-picture" : "map-text"}${progress.filled === capacity ? " complete" : ""}" style="--map-size:${gridSize};--map-image-scale:${gridSize * 100}%;${artwork.image ? `--phrase-image:url('${artwork.image}');` : ""}" role="img" aria-label="${progress.filled === capacity ? escapeHtml(artwork.name) : "Скрытое изображение"}. Открыто ${progress.filled} из ${capacity} клеток"><div class="map-pixels" aria-hidden="true">${cells}</div></div></div>
          <div class="map-progress-row"><span>${progress.filled} / ${capacity} клеток</span><strong>${progress.percent}%</strong></div>
          <div class="map-unit">${unitCaption}</div>
          <div class="map-chapter-nav" role="group" aria-label="Карты прогресса"><button type="button" data-map-page="prev" aria-label="Предыдущая карта"${progress.page === 0 ? " disabled" : ""}>←</button><span>Карта ${progress.page + 1}</span><button type="button" data-map-page="next" aria-label="Следующая карта"${progress.page >= progress.lastPage ? " disabled" : ""}>→</button></div>
          <div class="map-discovery${progress.filled === capacity ? " complete" : ""}" role="status">${escapeHtml(status)}</div>
          <p class="map-help">${source.kind === "sessions" ? "Учитываются кардиозаписи с заполненным результатом. " : ""}Клетки заполняются из твоих записей за всё время. Пропуски не стирают накопленное.</p>
        </section>`;
      const repaint = (focusSelector) => {
        this.render(host, state, today);
        host.querySelector(focusSelector)?.focus({ preventScroll: true });
      };
      host.querySelector("#map-source").addEventListener("change", (event) => {
        sourceId = event.target.value;
        selectedPage = null;
        savePreferences();
        repaint("#map-source");
      });
      host.querySelectorAll("[data-map-art]").forEach((button) => button.addEventListener("click", () => {
        mode = button.dataset.mapArt;
        savePreferences();
        repaint(`[data-map-art="${mode}"]`);
      }));
      host.querySelectorAll("[data-map-page]").forEach((button) => button.addEventListener("click", () => {
        selectedPage = progress.page + (button.dataset.mapPage === "prev" ? -1 : 1);
        repaint(`[data-map-page="${button.dataset.mapPage}"]`);
      }));
      host.querySelector("#map-cell-size").addEventListener("change", (event) => {
        gridSize = resolveSize(event.target.value);
        selectedPage = null;
        savePreferences();
        repaint("#map-cell-size");
      });
      if (mode === "text") {
        const editor = host.querySelector(".map-phrase-editor");
        const input = host.querySelector("#map-phrase-input");
        const save = host.querySelector("#map-phrase-save");
        const error = host.querySelector("#map-phrase-error");
        const counter = host.querySelector("#map-phrase-counter");
        editor.addEventListener("toggle", () => { editorOpen = editor.open; });
        const validate = () => {
          const result = validateMapPhrase(input.value);
          counter.textContent = `${result.length} / ${MAX_PHRASE_LENGTH}`;
          error.textContent = result.length ? result.error : "";
          input.setAttribute("aria-invalid", String(!!result.length && !result.valid));
          save.disabled = !result.valid || result.text === customPhrase;
          save.textContent = result.valid && result.text === customPhrase ? "Сохранено" : "Применить";
          return result;
        };
        input.addEventListener("input", () => { phraseDrafts.set(sourceId, input.value); validate(); });
        host.querySelector("#map-phrase-form").addEventListener("submit", (event) => {
          event.preventDefault();
          const result = validate();
          if (!result.valid) { error.textContent = result.error; input.focus(); return; }
          phrases.set(sourceId, result.text);
          if (!savePreferences()) {
            if (customPhrase) phrases.set(sourceId, customPhrase); else phrases.delete(sourceId);
            error.textContent = "Не удалось сохранить фразу на этом устройстве.";
            return;
          }
          phraseDrafts.delete(sourceId);
          editorOpen = true;
          repaint("#map-phrase-input");
        });
        host.querySelector("#map-phrase-auto").addEventListener("click", () => {
          phrases.delete(sourceId);
          if (!savePreferences()) {
            if (customPhrase) phrases.set(sourceId, customPhrase);
            error.textContent = "Не удалось сохранить настройку на этом устройстве.";
            return;
          }
          phraseDrafts.delete(sourceId);
          editorOpen = true;
          repaint("#map-phrase-input");
        });
        validate();
      }
    },
  };
}
