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

export function createApp({ db, token, allowOrigin, maxBody, allow = () => true }) {
  const cors = {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  };

  return async function handler(req, res) {
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname;

    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    if (req.method === "GET" && path === "/health") {
      sendJson(res, 200, { ok: true }, cors);
      return;
    }

    if (path === "/state") {
      await handleState(req, res, { db, token, maxBody, cors, allow });
      return;
    }

    sendJson(res, 404, { error: "not found" }, cors);
  };
}

async function handleState(req, res, { db, token, maxBody, cors, allow }) {
  const ip = req.socket.remoteAddress || "unknown";
  if (!allow(ip)) {
    sendJson(res, 429, { error: "rate limited" }, cors);
    return;
  }

  const provided = extractBearer(req.headers["authorization"]);
  if (!tokenMatches(token, provided)) {
    sendJson(res, 401, { error: "unauthorized" }, cors);
    return;
  }

  if (req.method === "GET") {
    sendJson(res, 200, db.getState(), cors);
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
    db.setState(parsed.state, updatedAt);
    sendJson(res, 200, { updatedAt }, cors);
    return;
  }

  sendJson(res, 405, { error: "method not allowed" }, cors);
}
