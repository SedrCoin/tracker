export function loadConfig(env = process.env) {
  const token = env.TRACKER_TOKEN;
  if (!token) throw new Error("TRACKER_TOKEN is required");
  const fatsecret =
    env.FATSECRET_CLIENT_ID && env.FATSECRET_CLIENT_SECRET
      ? { clientId: env.FATSECRET_CLIENT_ID, clientSecret: env.FATSECRET_CLIENT_SECRET }
      : null;
  return {
    token,
    port: Number(env.PORT || 8787),
    dbPath: env.DB_PATH || "./data/tracker.json",
    allowOrigin: env.ALLOW_ORIGIN || "https://sedrcoin.github.io",
    maxBody: Number(env.MAX_BODY || 2_000_000),
    fatsecret,
  };
}
