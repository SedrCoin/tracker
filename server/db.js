import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Хранилище состояния — простой JSON-файл с атомарной записью (tmp + rename).
// Без внешних зависимостей и без node:sqlite, поэтому работает на Node ≥ 18.
// path === ":memory:" — состояние в памяти (для тестов).
export function openDb(path) {
  const isMem = path === ":memory:";
  let mem = null;
  if (!isMem) mkdirSync(dirname(path), { recursive: true });
  const backupDir = !isMem ? join(dirname(path), "backups") : null;

  function stamp() {
    return new Date().toISOString().replace(/[:.]/g, "-");
  }

  function backup() {
    if (isMem || !existsSync(path)) return null;
    mkdirSync(backupDir, { recursive: true });
    const p = join(backupDir, `tracker-${stamp()}.json`);
    copyFileSync(path, p);
    return p;
  }

  function normalize(row) {
    if (!row) return { state: null, updatedAt: 0, users: {}, userStates: {} };
    if (!row.users) row.users = {};
    if (!row.userStates) row.userStates = {};
    if (!("state" in row)) row.state = null;
    if (!("updatedAt" in row)) row.updatedAt = 0;
    return row;
  }

  function read() {
    if (isMem) return mem;
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch {
      return null; // битый файл — считаем пустым, не падаем
    }
  }
  function write(obj) {
    if (isMem) {
      mem = obj;
      return;
    }
    const tmp = path + ".tmp";
    writeFileSync(tmp, JSON.stringify(obj));
    renameSync(tmp, path); // атомарная замена — без частично записанного файла
  }

  return {
    getState() {
      const row = normalize(read());
      return row ? { state: row.state, updatedAt: row.updatedAt } : { state: null, updatedAt: 0 };
    },
    setState(stateObj, updatedAt) {
      const row = normalize(read());
      row.state = stateObj;
      row.updatedAt = updatedAt;
      backup();
      write(row);
      return updatedAt;
    },
    createUser(profile, initialState, updatedAt) {
      const row = normalize(read());
      const userId = randomUUID();
      const token = "trk_" + randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
      row.users[userId] = { id: userId, token, profile, createdAt: updatedAt, updatedAt };
      row.userStates[userId] = { state: initialState, updatedAt };
      backup();
      write(row);
      return { userId, token, profile: row.users[userId].profile, updatedAt };
    },
    getUserByToken(token) {
      const row = normalize(read());
      return Object.values(row.users).find((u) => u.token === token) || null;
    },
    getUserState(userId) {
      const row = normalize(read());
      const item = row.userStates[userId];
      return item ? { state: item.state, updatedAt: item.updatedAt } : { state: null, updatedAt: 0 };
    },
    setUserState(userId, stateObj, updatedAt) {
      const row = normalize(read());
      row.userStates[userId] = { state: stateObj, updatedAt };
      if (row.users[userId]) row.users[userId].updatedAt = updatedAt;
      backup();
      write(row);
      return updatedAt;
    },
    backup,
    close() {},
  };
}
