export function loadConfig(env = process.env) {
  const token = env.TRACKER_TOKEN;
  if (!token) throw new Error("TRACKER_TOKEN is required");
  return {
    token,
    port: Number(env.PORT || 8787),
    dbPath: env.DB_PATH || "./data/tracker.sqlite",
    allowOrigin: env.ALLOW_ORIGIN || "https://sedrcoin.github.io",
    maxBody: Number(env.MAX_BODY || 2_000_000),
  };
}
