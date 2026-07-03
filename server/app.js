import { extractBearer, tokenMatches } from "./auth.js";

function sendJson(res, status, obj, cors) {
  res.writeHead(status, { "Content-Type": "application/json", ...cors });
  res.end(JSON.stringify(obj));
}

function readBody(req, maxBody) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let aborted = false;
    req.on("data", (c) => {
      if (aborted) return;
      size += c.length;
      if (size > maxBody) {
        aborted = true;
        req.resume(); // дренируем остаток, но не копим — чтобы ответ 413 ушёл
        reject(Object.assign(new Error("too large"), { code: "TOO_LARGE" }));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function createApp({ db, token, allowOrigin, maxBody, allow = () => true, fatsecret = null }) {
  const cors = {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  };

  return async function handler(req, res) {
    const url = new URL(req.url, "http://localhost");
    let path = url.pathname;
    if (path === "/trackerapi") path = "/";
    if (path.startsWith("/trackerapi/")) path = path.slice("/trackerapi".length);

    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    if (req.method === "GET" && path === "/health") {
      sendJson(res, 200, { ok: true }, cors);
      return;
    }

    if (path === "/auth/register") {
      await handleRegister(req, res, { db, maxBody, cors, allow });
      return;
    }

    if (path === "/auth/me") {
      await handleMe(req, res, { db, token, cors, allow });
      return;
    }

    if (path === "/backup") {
      await handleBackup(req, res, { db, token, cors, allow });
      return;
    }

    if (path === "/state") {
      await handleState(req, res, { db, token, maxBody, cors, allow });
      return;
    }

    if (path === "/rooms" || path.startsWith("/rooms/")) {
      await handleRooms(req, res, { db, token, maxBody, cors, allow, path });
      return;
    }

    if (path === "/foods/search" || path === "/foods/get") {
      await handleFoods(req, res, { db, token, fatsecret, cors, allow, path, url });
      return;
    }

    sendJson(res, 404, { error: "not found" }, cors);
  };
}

async function readJson(req, maxBody) {
  const raw = await readBody(req, maxBody);
  if (!raw) return {};
  return JSON.parse(raw);
}

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(iso, n) {
  const [y, m, d] = String(iso || "").split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function validISO(iso) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(iso || ""));
}

function cleanRules(rules) {
  if (!Array.isArray(rules)) return [];
  return rules.map((r) => String(r || "").trim().slice(0, 120)).filter(Boolean).slice(0, 12);
}

function publicRoom(room) {
  const participants = {};
  for (const [id, p] of Object.entries((room && room.participants) || {})) {
    participants[id] = {
      name: p.name,
      checks: p.checks || {},
      status: p.status || "active",
      joinedAt: p.joinedAt,
    };
  }
  return {
    code: room.code,
    name: room.name,
    durationDays: room.durationDays,
    startDate: room.startDate,
    strict: !!room.strict,
    rules: room.rules || [],
    createdAt: room.createdAt,
    participants,
  };
}

function authenticatedUser(db, token, req) {
  const provided = extractBearer(req.headers["authorization"]);
  if (tokenMatches(token, provided)) return { legacy: true, profile: { name: "Артём" } };
  const user = db.getUserByToken(provided);
  return user ? { legacy: false, profile: user.profile || {} } : null;
}

async function handleRooms(req, res, { db, token, maxBody, cors, allow, path }) {
  const ip = req.socket.remoteAddress || "unknown";
  if (!allow(ip)) {
    sendJson(res, 429, { error: "rate limited" }, cors);
    return;
  }

  if (path === "/rooms") {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "method not allowed" }, cors);
      return;
    }
    const user = authenticatedUser(db, token, req);
    if (!user) {
      sendJson(res, 401, { error: "unauthorized" }, cors);
      return;
    }
    let body;
    try {
      body = await readJson(req, maxBody);
    } catch (e) {
      sendJson(res, e.code === "TOO_LARGE" ? 413 : 400, { error: e.code === "TOO_LARGE" ? "too large" : "bad json" }, cors);
      return;
    }
    const durationDays = Math.max(1, Math.min(365, parseInt(body.durationDays, 10) || 0));
    const name = String(body.name || "").trim().slice(0, 80);
    const startDate = String(body.startDate || "").trim();
    if (!name || !durationDays || !validISO(startDate)) {
      sendJson(res, 400, { error: "bad room" }, cors);
      return;
    }
    try {
      const created = db.createRoom(
        {
          name,
          durationDays,
          startDate,
          strict: !!body.strict,
          rules: cleanRules(body.rules),
          checks: body.checks && typeof body.checks === "object" ? body.checks : {},
        },
        body.participantName || user.profile.name || "Участник"
      );
      sendJson(res, 200, { code: created.code, participantId: created.participantId, secret: created.secret, room: publicRoom(created.room) }, cors);
    } catch (e) {
      sendJson(res, e.code === "ROOM_LIMIT" ? 409 : 500, { error: e.code === "ROOM_LIMIT" ? "room limit" : "room create failed" }, cors);
    }
    return;
  }

  const match = /^\/rooms\/([A-Z0-9]{3,12})(?:\/(join|checkin|leave))?$/.exec(path);
  if (!match) {
    sendJson(res, 404, { error: "not found" }, cors);
    return;
  }
  const code = match[1].toUpperCase();
  const action = match[2] || "";

  if (!action && req.method === "GET") {
    const room = db.getRoom(code);
    if (!room) {
      sendJson(res, 404, { error: "room not found" }, cors);
      return;
    }
    sendJson(res, 200, { room: publicRoom(room) }, cors);
    return;
  }

  if (action === "join" && req.method === "POST") {
    let body;
    try {
      body = await readJson(req, maxBody);
    } catch {
      sendJson(res, 400, { error: "bad json" }, cors);
      return;
    }
    try {
      const joined = db.joinRoom(code, body.name);
      if (!joined) {
        sendJson(res, 404, { error: "room not found" }, cors);
        return;
      }
      sendJson(res, 200, { participantId: joined.participantId, secret: joined.secret, room: publicRoom(joined.room) }, cors);
    } catch (e) {
      const status = e.code === "BAD_NAME" ? 400 : 409;
      sendJson(res, status, { error: e.code === "ROOM_FULL" ? "room full" : e.code === "DUPLICATE_NAME" ? "duplicate name" : "bad name" }, cors);
    }
    return;
  }

  if ((action === "checkin" || action === "leave") && req.method === "POST") {
    let body;
    try {
      body = await readJson(req, maxBody);
    } catch {
      sendJson(res, 400, { error: "bad json" }, cors);
      return;
    }
    const room = db.getRoom(code);
    const participant = room && room.participants && room.participants[body.participantId];
    if (!room) {
      sendJson(res, 404, { error: "room not found" }, cors);
      return;
    }
    if (!participant || !tokenMatches(participant.secret, body.secret)) {
      sendJson(res, 401, { error: "unauthorized" }, cors);
      return;
    }
    if (action === "checkin") {
      const date = String(body.date || "");
      const endDate = addDays(room.startDate, (Number(room.durationDays) || 1) - 1);
      if (!validISO(date) || date < room.startDate || date > endDate || date > todayISO()) {
        sendJson(res, 400, { error: "bad date" }, cors);
        return;
      }
      const updated = db.updateRoomParticipant(code, body.participantId, (p) => {
        if (!p.checks || typeof p.checks !== "object") p.checks = {};
        p.checks[date] = !!body.done;
      });
      sendJson(res, 200, { room: publicRoom(updated) }, cors);
      return;
    }
    const updated = db.updateRoomParticipant(code, body.participantId, (p) => {
      p.status = "stopped";
    });
    sendJson(res, 200, { room: publicRoom(updated) }, cors);
    return;
  }

  sendJson(res, 405, { error: "method not allowed" }, cors);
}

async function handleBackup(req, res, { db, token, cors, allow }) {
  const ip = req.socket.remoteAddress || "unknown";
  if (!allow(ip)) {
    sendJson(res, 429, { error: "rate limited" }, cors);
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method not allowed" }, cors);
    return;
  }
  const provided = extractBearer(req.headers["authorization"]);
  if (!tokenMatches(token, provided)) {
    sendJson(res, 401, { error: "unauthorized" }, cors);
    return;
  }
  sendJson(res, 200, { ok: true, path: db.backup() }, cors);
}

async function handleRegister(req, res, { db, maxBody, cors, allow }) {
  const ip = req.socket.remoteAddress || "unknown";
  if (!allow(ip)) {
    sendJson(res, 429, { error: "rate limited" }, cors);
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method not allowed" }, cors);
    return;
  }
  let raw;
  try {
    raw = await readBody(req, maxBody);
  } catch {
    sendJson(res, 400, { error: "bad body" }, cors);
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    sendJson(res, 400, { error: "invalid json" }, cors);
    return;
  }
  const profile = parsed && parsed.profile;
  if (!profile || typeof profile.name !== "string" || !profile.name.trim()) {
    sendJson(res, 400, { error: "missing profile name" }, cors);
    return;
  }
  const cleanProfile = {
    name: profile.name.trim().slice(0, 80),
    height: profile.height ? Number(profile.height) : null,
    weight: profile.weight ? Number(profile.weight) : null,
    photo: typeof profile.photo === "string" ? profile.photo : "",
    measurements: profile.measurements && typeof profile.measurements === "object" ? profile.measurements : {},
  };
  const now = Date.now();
  const initialState = parsed.state && typeof parsed.state === "object" ? parsed.state : null;
  const created = db.createUser(cleanProfile, initialState, now);
  sendJson(res, 200, created, cors);
}

async function handleMe(req, res, { db, token, cors, allow }) {
  const ip = req.socket.remoteAddress || "unknown";
  if (!allow(ip)) {
    sendJson(res, 429, { error: "rate limited" }, cors);
    return;
  }
  const provided = extractBearer(req.headers["authorization"]);
  if (tokenMatches(token, provided)) {
    sendJson(res, 200, { legacy: true, profile: null }, cors);
    return;
  }
  const user = db.getUserByToken(provided);
  if (!user) {
    sendJson(res, 401, { error: "unauthorized" }, cors);
    return;
  }
  sendJson(res, 200, { legacy: false, userId: user.id, profile: user.profile }, cors);
}

async function handleFoods(req, res, { db, token, fatsecret, cors, allow, path, url }) {
  const ip = req.socket.remoteAddress || "unknown";
  if (!allow(ip)) {
    sendJson(res, 429, { error: "rate limited" }, cors);
    return;
  }
  const provided = extractBearer(req.headers["authorization"]);
  if (!tokenMatches(token, provided) && !db.getUserByToken(provided)) {
    sendJson(res, 401, { error: "unauthorized" }, cors);
    return;
  }
  if (!fatsecret) {
    sendJson(res, 503, { error: "fatsecret not configured" }, cors);
    return;
  }
  try {
    if (path === "/foods/search") {
      const q = (url.searchParams.get("q") || "").trim();
      if (!q) {
        sendJson(res, 400, { error: "empty query" }, cors);
        return;
      }
      sendJson(res, 200, { foods: await fatsecret.searchFoods(q) }, cors);
      return;
    }
    // /foods/get
    const id = (url.searchParams.get("id") || "").trim();
    if (!id) {
      sendJson(res, 400, { error: "no id" }, cors);
      return;
    }
    sendJson(res, 200, { food: await fatsecret.getFood(id) }, cors);
  } catch (e) {
    sendJson(res, 502, { error: String((e && e.message) || e) }, cors);
  }
}

async function handleState(req, res, { db, token, maxBody, cors, allow }) {
  const ip = req.socket.remoteAddress || "unknown";
  if (!allow(ip)) {
    sendJson(res, 429, { error: "rate limited" }, cors);
    return;
  }

  const provided = extractBearer(req.headers["authorization"]);
  const legacy = tokenMatches(token, provided);
  const user = legacy ? null : db.getUserByToken(provided);
  if (!legacy && !user) {
    sendJson(res, 401, { error: "unauthorized" }, cors);
    return;
  }

  if (req.method === "GET") {
    sendJson(res, 200, legacy ? db.getState() : db.getUserState(user.id), cors);
    return;
  }

  if (req.method === "PUT") {
    let raw;
    try {
      raw = await readBody(req, maxBody);
    } catch (e) {
      if (e.code === "TOO_LARGE") {
        sendJson(res, 413, { error: "too large" }, cors);
        return;
      }
      sendJson(res, 400, { error: "bad body" }, cors);
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      sendJson(res, 400, { error: "invalid json" }, cors);
      return;
    }
    if (!parsed || typeof parsed !== "object" || !("state" in parsed)) {
      sendJson(res, 400, { error: "missing state" }, cors);
      return;
    }
    const incoming = Number(parsed.updatedAt) || 0;
    const updatedAt = Math.max(incoming, Date.now());
    if (legacy) db.setState(parsed.state, updatedAt);
    else db.setUserState(user.id, parsed.state, updatedAt);
    sendJson(res, 200, { updatedAt }, cors);
    return;
  }

  sendJson(res, 405, { error: "method not allowed" }, cors);
}
