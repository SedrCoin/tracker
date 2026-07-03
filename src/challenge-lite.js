const root = document.getElementById("lite-root");

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(iso, n) {
  const [y, m, d] = String(iso || "").split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function daysBetween(fromISO, toISO) {
  const [fy, fm, fd] = fromISO.split("-").map(Number);
  const [ty, tm, td] = toISO.split("-").map(Number);
  return Math.round((new Date(ty, tm - 1, td) - new Date(fy, fm - 1, fd)) / 86400000);
}

function currentApi() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get("api");
  if (fromUrl) {
    localStorage.setItem("tracker.challenge.api", fromUrl);
    return fromUrl.replace(/\/$/, "");
  }
  const saved = localStorage.getItem("tracker.challenge.api");
  if (saved) return saved.replace(/\/$/, "");
  if (window.location.protocol === "https:" && !window.location.hostname.endsWith("github.io")) {
    return `${window.location.origin}/trackerapi`;
  }
  return "";
}

const api = currentApi();
const code = String(window.location.hash || "").replace(/^#/, "").trim().toUpperCase();
const participantKey = code ? `tracker.challenge.participant.${code}` : "";

function storedParticipant() {
  if (!participantKey) return null;
  const raw = localStorage.getItem(participantKey);
  return raw ? JSON.parse(raw) : null;
}

function saveParticipant(participant) {
  localStorage.setItem(participantKey, JSON.stringify(participant));
}

async function request(path, options = {}) {
  const res = await fetch(`${api}${path}`, options);
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

function participantRows(room) {
  return Object.values(room.participants || {})
    .map((p) => {
      const checks = p.checks || {};
      const done = Object.values(checks).filter(Boolean).length;
      const todayDone = checks[todayISO()] === true;
      return `<div class="participant-row">
        <div><span>${esc(p.name)}</span><b>${done}/${room.durationDays} дней</b></div>
        <em class="${todayDone ? "done" : ""}">${todayDone ? "сегодня" : "—"}</em>
      </div>`;
    })
    .join("");
}

function calendarHtml(room, me) {
  const today = todayISO();
  const checks = me && room.participants && room.participants[me.participantId]
    ? room.participants[me.participantId].checks || {}
    : {};
  const cells = Array.from({ length: room.durationDays }, (_, i) => {
    const iso = addDays(room.startDate, i);
    const done = checks[iso] === true;
    const missed = iso < today && !done;
    const future = iso > today;
    return `<span class="challenge-day ${done ? "done" : ""} ${missed ? "missed" : ""} ${future ? "future" : ""} ${iso === today ? "today" : ""}">${i + 1}</span>`;
  }).join("");
  return `<div class="challenge-calendar">${cells}</div>`;
}

function canCheckToday(room) {
  const today = todayISO();
  return today >= room.startDate && today <= addDays(room.startDate, room.durationDays - 1);
}

function renderRoom(room) {
  const me = storedParticipant();
  const mine = me && room.participants && room.participants[me.participantId];
  const checked = !!(mine && mine.checks && mine.checks[todayISO()]);
  const day = Math.max(1, Math.min(room.durationDays, daysBetween(room.startDate, todayISO()) + 1));
  const finished = todayISO() > addDays(room.startDate, room.durationDays - 1);
  root.innerHTML = `
    <div class="lite-shell">
      <div class="challenge-detail-hero accent-focus" style="--challenge-progress:${Math.round((day / room.durationDays) * 360)}deg">
        <div class="challenge-ring big"><span>${day}</span></div>
        <div>
          <div class="challenge-title">${esc(room.name)}</div>
          <div class="challenge-meta">${finished ? "Итоги" : `День ${day} из ${room.durationDays}`} · код ${esc(room.code)}</div>
        </div>
      </div>
      ${me ? `<button class="btn challenge-done ${checked ? "blue" : ""}" id="lite-check" ${canCheckToday(room) ? "" : "disabled"}>${checked ? "Сегодня выполнено" : "Отметить сегодня"}</button>` : `
        <section class="card challenge-form">
          <div class="section-head"><div class="title">Присоединиться</div></div>
          <label class="onboard-field">Имя<input id="join-name" maxlength="30" placeholder="Имя"></label>
          <button class="btn" id="join-btn">Войти в челлендж</button>
        </section>`}
      <section class="card participants-card">
        <div class="section-head"><div class="title">Участники</div></div>
        ${participantRows(room)}
      </section>
      <section class="card challenge-calendar-card">
        <div class="section-head"><div class="title">Календарь</div></div>
        ${calendarHtml(room, me)}
      </section>
      <section class="card challenge-rules">
        <div class="section-head"><div class="title">Правила</div></div>
        ${(room.rules || []).length ? `<ul>${room.rules.map((rule) => `<li>${esc(rule)}</li>`).join("")}</ul>` : `<div class="empty-hint">Правила не заданы</div>`}
      </section>
      <div class="lite-install">Можно добавить эту страницу на экран Домой через меню браузера.</div>
    </div>`;

  const joinBtn = document.getElementById("join-btn");
  if (joinBtn) joinBtn.addEventListener("click", async () => {
    const name = document.getElementById("join-name").value.trim();
    if (!name) return;
    joinBtn.disabled = true;
    joinBtn.textContent = "Вхожу...";
    try {
      const joined = await request(`/rooms/${encodeURIComponent(code)}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      saveParticipant({ participantId: joined.participantId, secret: joined.secret });
      renderRoom(joined.room);
    } catch {
      joinBtn.disabled = false;
      joinBtn.textContent = "Не получилось, попробуй другое имя";
    }
  });

  const checkBtn = document.getElementById("lite-check");
  if (checkBtn && me) checkBtn.addEventListener("click", async () => {
    checkBtn.disabled = true;
    try {
      const updated = await request(`/rooms/${encodeURIComponent(code)}/checkin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId: me.participantId, secret: me.secret, date: todayISO(), done: !checked }),
      });
      renderRoom(updated.room);
    } catch {
      checkBtn.disabled = false;
      checkBtn.textContent = "Нет связи";
    }
  });
}

async function boot() {
  if (!api || !code) {
    root.innerHTML = `<section class="card empty-challenge">Ссылка челленджа неполная.</section>`;
    return;
  }
  try {
    const { room } = await request(`/rooms/${encodeURIComponent(code)}`);
    renderRoom(room);
  } catch {
    root.innerHTML = `<section class="card empty-challenge">Челлендж не найден или сервер недоступен.</section>`;
  }
}

boot();
