// src/sync.js — клиент синхронизации с бэкендом.
const CFG_KEY = "tracker.sync.cfg.v1";

export function chooseNewer(localUpdatedAt, remoteUpdatedAt) {
  return remoteUpdatedAt > localUpdatedAt ? "remote" : "local";
}

export function loadSyncConfig(ls) {
  const raw = ls.getItem(CFG_KEY);
  return raw ? JSON.parse(raw) : { apiUrl: "", token: "" };
}

export function saveSyncConfig(ls, cfg) {
  ls.setItem(CFG_KEY, JSON.stringify({ apiUrl: cfg.apiUrl || "", token: cfg.token || "" }));
}

export function isConfigured(cfg) {
  return !!(cfg.apiUrl && cfg.token);
}

// fetcher инъектируется (в браузере — window.fetch) для тестируемости.
export function createSyncClient(cfg, fetcher) {
  const base = cfg.apiUrl.replace(/\/$/, "");
  const headers = { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" };
  return {
    async pull() {
      const res = await fetcher(`${base}/state`, { headers });
      if (!res.ok) throw new Error("pull failed: " + res.status);
      return res.json(); // { state, updatedAt }
    },
    async push(state, updatedAt) {
      const res = await fetcher(`${base}/state`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ state, updatedAt }),
      });
      if (!res.ok) throw new Error("push failed: " + res.status);
      return res.json(); // { updatedAt }
    },
  };
}
