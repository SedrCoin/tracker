import { createServer } from "node:http";
import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { createApp } from "./app.js";
import { createRateLimiter } from "./rateLimit.js";
import { createFatSecret } from "./fatsecret.js";

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const allow = createRateLimiter({ max: 60, windowMs: 60_000 });
const fatsecret = cfg.fatsecret ? createFatSecret(cfg.fatsecret) : null;
const app = createApp({
  db,
  token: cfg.token,
  allowOrigin: cfg.allowOrigin,
  maxBody: cfg.maxBody,
  allow,
  fatsecret,
});

createServer(app).listen(cfg.port, "127.0.0.1", () => {
  console.log(
    `tracker-server on 127.0.0.1:${cfg.port}, db=${cfg.dbPath}, fatsecret=${fatsecret ? "on" : "off"}`
  );
});
