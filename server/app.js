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

    if (path === "/foods/search" || path === "/foods/get") {
      await handleFoods(req, res, { db, token, fatsecret, cors, allow, path, url });
      return;
    }

    sendJson(res, 404, { error: "not found" }, cors);
  };
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
