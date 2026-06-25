import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

// Хранилище состояния — простой JSON-файл с атомарной записью (tmp + rename).
// Без внешних зависимостей и без node:sqlite, поэтому работает на Node ≥ 18.
// path === ":memory:" — состояние в памяти (для тестов).
export function openDb(path) {
  const isMem = path === ":memory:";
  let mem = null;
  if (!isMem) mkdirSync(dirname(path), { recursive: true });

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
      const row = read();
      return row ? { state: row.state, updatedAt: row.updatedAt } : { state: null, updatedAt: 0 };
    },
    setState(stateObj, updatedAt) {
      write({ state: stateObj, updatedAt });
      return updatedAt;
    },
    close() {},
  };
}
