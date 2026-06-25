import { createServer } from "node:http";
import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { createApp } from "./app.js";
import { createRateLimiter } from "./rateLimit.js";

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const allow = createRateLimiter({ max: 60, windowMs: 60_000 });
const app = createApp({
  db,
  token: cfg.token,
  allowOrigin: cfg.allowOrigin,
  maxBody: cfg.maxBody,
  allow,
});

createServer(app).listen(cfg.port, "127.0.0.1", () => {
  console.log(`tracker-server on 127.0.0.1:${cfg.port}, db=${cfg.dbPath}`);
});
