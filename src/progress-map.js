import { addDays } from "./logic.js";
import { SUMMIT_COLORS } from "./progress-art.js";

export const MAP_SIZE = 20;
export const MAP_CELLS = MAP_SIZE * MAP_SIZE;
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

export function mapProgress(total, cellsPerUnit = 1, requestedPage = null) {
  const multiplier = cellsPerUnit === 10 ? 10 : 1;
  const cells = Math.min(MAX, positiveInteger(total) * multiplier);
  const completed = Math.floor(cells / MAP_CELLS);
  // Keep a just-completed picture visible until the next real action arrives.
  const currentPage = Math.max(0, Math.ceil(cells / MAP_CELLS) - 1);
  const lastPage = completed;
  const page = requestedPage == null ? currentPage : Math.min(lastPage, positiveInteger(requestedPage));
  const filled = Math.max(0, Math.min(MAP_CELLS, cells - page * MAP_CELLS));
  return { cells, completed, currentPage, lastPage, page, filled, percent: Math.floor(filled / MAP_CELLS * 100), remaining: Math.ceil((MAP_CELLS - filled) / multiplier) };
}

function hash(value) {
  let result = 2166136261;
  for (const char of String(value)) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return result >>> 0;
}

// Breadth-first expansion keeps every new cell attached to the existing patch.
// A stable seed preserves the picture and filled positions on every reload.
export function mapRevealOrder(seed) {
  const number = hash(seed);
  const start = (14 + number % 3) * MAP_SIZE + 3 + (number >>> 4) % 5;
  const order = [start];
  const seen = new Set(order);
  const directions = [[0, -1], [1, 0], [-1, 0], [0, 1]];
  const offset = number % directions.length;
  for (let i = 0; i < order.length; i += 1) {
    const x = order[i] % MAP_SIZE, y = Math.floor(order[i] / MAP_SIZE);
    for (let j = 0; j < directions.length; j += 1) {
      const [dx, dy] = directions[(j + offset) % directions.length];
      const nx = x + dx, ny = y + dy, next = ny * MAP_SIZE + nx;
      if (nx < 0 || nx >= MAP_SIZE || ny < 0 || ny >= MAP_SIZE || seen.has(next)) continue;
      seen.add(next);
      order.push(next);
    }
  }
  return order;
}

// Compact Cyrillic glyphs are text, rendered directly into the same cell grid.
const GLYPHS = {
  А: ["0110", "1001", "1111", "1001", "1001"],
  В: ["1110", "1001", "1110", "1001", "1110"],
  Г: ["1111", "1000", "1000", "1000", "1000"],
  Д: ["0110", "0110", "1010", "1111", "1001"],
  Е: ["1111", "1000", "1110", "1000", "1111"],
  З: ["1110", "0001", "0110", "0001", "1110"],
  И: ["1001", "1011", "1101", "1001", "1001"],
  Л: ["0011", "0101", "0101", "1001", "1001"],
  М: ["1001", "1111", "1111", "1001", "1001"],
  Н: ["1001", "1001", "1111", "1001", "1001"],
  О: ["0110", "1001", "1001", "1001", "0110"],
  С: ["0111", "1000", "1000", "1000", "0111"],
  Т: ["1111", "0110", "0110", "0110", "0110"],
  Ш: ["10101", "10101", "10101", "10101", "11111"],
  Ы: ["10001", "10001", "11101", "10101", "11101"],
  Ь: ["1000", "1000", "1110", "1001", "1110"],
  Я: ["0111", "1001", "0111", "0101", "1001"],
};
const PHRASES = [["ТЫ", "СМОГ"], ["ТВОЯ", "СИЛА"], ["ДЕНЬ", "ЗА", "ДНЕМ"]];
const TEXT_PALETTES = [["#e4f2d5", "#cde7b5", "#245620"], ["#e1eefb", "#c7dff6", "#24418c"], ["#fff0d5", "#ffe0a4", "#85430e"]];

export function mapArtwork(mode, page = 0) {
  if (mode !== "text") return { name: "Путь к вершине", colors: SUMMIT_COLORS };
  const index = positiveInteger(page) % PHRASES.length;
  const lines = PHRASES[index];
  const [background, accent, ink] = TEXT_PALETTES[index];
  const colors = Array.from({ length: MAP_CELLS }, (_, i) => (Math.floor(i / MAP_SIZE) < 2 || Math.floor(i / MAP_SIZE) > 17) ? accent : background);
  const lineGap = lines.length === 3 ? 1 : 3;
  const height = lines.length * 5 + (lines.length - 1) * lineGap;
  const top = Math.floor((MAP_SIZE - height) / 2);
  lines.forEach((line, lineIndex) => {
    const glyphs = [...line].map((char) => GLYPHS[char]);
    const width = glyphs.reduce((sum, glyph) => sum + glyph[0].length, 0) + glyphs.length - 1;
    let left = Math.floor((MAP_SIZE - width) / 2);
    for (const glyph of glyphs) {
      glyph.forEach((row, y) => [...row].forEach((pixel, x) => {
        if (pixel === "1") colors[(top + lineIndex * (5 + lineGap) + y) * MAP_SIZE + left + x] = ink;
      }));
      left += glyph[0].length + 1;
    }
  });
  return { name: lines.join(" "), colors };
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
  let selectedPage = null;
  const lastCounts = new Map();
  const savePreferences = () => {
    try { storage.setItem(PREFS_KEY, JSON.stringify({ sourceId, mode })); } catch { /* Works in memory when storage is full. */ }
  };

  return {
    render(host, state, today) {
      const sources = collectMapSources(state, today);
      const source = sources.find((item) => item.id === sourceId) || sources[0];
      sourceId = source.id;
      const previousCount = lastCounts.get(sourceId);
      if (previousCount != null && previousCount !== source.total) selectedPage = null;
      const progress = mapProgress(source.total, source.cellsPerUnit, selectedPage);
      lastCounts.set(sourceId, source.total);
      const artwork = mapArtwork(mode, progress.page);
      const order = mapRevealOrder(`${source.id}:${progress.page}`);
      const ranks = new Array(MAP_CELLS);
      order.forEach((position, rank) => { ranks[position] = rank; });
      const priorFilled = previousCount == null
        ? Math.max(0, progress.filled - 40)
        : Math.max(0, Math.min(MAP_CELLS, previousCount * source.cellsPerUnit - progress.page * MAP_CELLS));
      const animationStart = Math.max(priorFilled, progress.filled - 80);
      const cells = artwork.colors.map((color, position) => {
        const rank = ranks[position];
        const revealed = rank < progress.filled;
        const fresh = revealed && rank >= animationStart;
        // Concealed cells never receive the hidden picture's color in the DOM.
        return `<span class="map-pixel${revealed ? " revealed" : ""}${fresh ? " fresh" : ""}"${revealed ? ` style="--pixel-color:${color};--pixel-delay:${Math.round((rank - animationStart) * 9)}ms"` : ""}></span>`;
      }).join("");
      const groups = [...new Set(sources.map((item) => item.group))];
      const options = groups.map((group) => `<optgroup label="${group}">${sources.filter((item) => item.group === group).map((item) => `<option value="${escapeHtml(item.id)}"${item.id === sourceId ? " selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}</optgroup>`).join("");
      const unitCaption = source.kind === "reps" ? "1 повтор = 1 клетка" : source.kind === "sessions" ? "1 тренировка = 10 клеток" : "1 день = 10 клеток";
      const status = progress.filled === MAP_CELLS
        ? `Открыто: ${artwork.name}`
        : source.total === 0
          ? "Запиши первое выполнение — появятся первые клетки."
          : `До раскрытия: ${units(progress.remaining, source.kind)}`;
      host.innerHTML = `
        <section class="card progress-map" aria-labelledby="progress-map-title">
          <div class="progress-map-heading"><div><div class="eyebrow">Метод карты</div><h2 id="progress-map-title">Твой прогресс в клетках</h2></div><span class="map-all-time">Всё время</span></div>
          <label class="map-source-label" for="map-source">Что считаем</label>
          <select id="map-source" class="map-source">${options}</select>
          <div class="map-total-row"><strong>${escapeHtml(units(source.total, source.kind))}</strong><span>${progress.completed} ${plural(progress.completed, ["карта открыта", "карты открыты", "карт открыто"])}</span></div>
          <div class="map-art-switch" role="group" aria-label="Что скрыто в клетках"><button type="button" data-map-art="picture" aria-pressed="${mode === "picture"}">Рисунок</button><button type="button" data-map-art="text" aria-pressed="${mode === "text"}">Фраза</button></div>
          <div class="map-mosaic-frame"><div class="map-mosaic" role="img" aria-label="${progress.filled === MAP_CELLS ? escapeHtml(artwork.name) : "Скрытое изображение"}. Открыто ${progress.filled} из ${MAP_CELLS} клеток"><div class="map-pixels" aria-hidden="true">${cells}</div></div></div>
          <div class="map-progress-row"><span>${progress.filled} / ${MAP_CELLS} клеток</span><strong>${progress.percent}%</strong></div>
          <div class="map-unit">${unitCaption}</div>
          <div class="map-chapter-nav" role="group" aria-label="Карты прогресса"><button type="button" data-map-page="prev" aria-label="Предыдущая карта"${progress.page === 0 ? " disabled" : ""}>←</button><span>Карта ${progress.page + 1}</span><button type="button" data-map-page="next" aria-label="Следующая карта"${progress.page >= progress.lastPage ? " disabled" : ""}>→</button></div>
          <div class="map-discovery${progress.filled === MAP_CELLS ? " complete" : ""}" role="status">${escapeHtml(status)}</div>
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
    },
  };
}
