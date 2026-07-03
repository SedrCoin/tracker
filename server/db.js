import { randomBytes, randomUUID } from "node:crypto";
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
    if (!row) return { state: null, updatedAt: 0, users: {}, userStates: {}, rooms: {} };
    if (!row.users) row.users = {};
    if (!row.userStates) row.userStates = {};
    if (!row.rooms) row.rooms = {};
    if (!("state" in row)) row.state = null;
    if (!("updatedAt" in row)) row.updatedAt = 0;
    return row;
  }

  function isoToTime(iso) {
    const [y, m, d] = String(iso || "").split("-").map(Number);
    if (!y || !m || !d) return NaN;
    return new Date(y, m - 1, d).getTime();
  }

  function cleanupRooms(row, now = Date.now()) {
    for (const [code, room] of Object.entries(row.rooms || {})) {
      const start = isoToTime(room.startDate);
      const ttl = ((Number(room.durationDays) || 1) + 60) * 86400000;
      if (Number.isFinite(start) && now - start > ttl) delete row.rooms[code];
    }
  }

  function roomCode(existing) {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    for (let tries = 0; tries < 100; tries++) {
      const bytes = randomBytes(8);
      const code = [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
      if (!existing[code]) return code;
    }
    throw new Error("cannot allocate room code");
  }

  function participantId(existing) {
    let id;
    do {
      id = "p_" + randomBytes(3).toString("hex");
    } while (existing[id]);
    return id;
  }

  function participantSecret() {
    return randomBytes(32).toString("hex");
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
    createRoom(roomInput, creatorName, now = Date.now()) {
      const row = normalize(read());
      cleanupRooms(row, now);
      if (Object.keys(row.rooms).length >= 20) {
        const err = new Error("room limit");
        err.code = "ROOM_LIMIT";
        throw err;
      }
      const code = roomCode(row.rooms);
      const pId = participantId({});
      const secret = participantSecret();
      const cleanName = String(creatorName || "Участник").trim().slice(0, 30) || "Участник";
      row.rooms[code] = {
        code,
        name: roomInput.name,
        durationDays: roomInput.durationDays,
        startDate: roomInput.startDate,
        strict: !!roomInput.strict,
        rules: Array.isArray(roomInput.rules) ? roomInput.rules : [],
        createdAt: now,
        participants: {
          [pId]: { name: cleanName, secret, checks: roomInput.checks || {}, status: "active", joinedAt: now },
        },
      };
      backup();
      write(row);
      return { code, participantId: pId, secret, room: row.rooms[code] };
    },
    getRoom(code) {
      const row = normalize(read());
      cleanupRooms(row);
      return row.rooms[String(code || "").toUpperCase()] || null;
    },
    joinRoom(code, name, now = Date.now()) {
      const row = normalize(read());
      cleanupRooms(row, now);
      const room = row.rooms[String(code || "").toUpperCase()];
      if (!room) return null;
      const cleanName = String(name || "").trim().slice(0, 30);
      if (!cleanName) {
        const err = new Error("bad name");
        err.code = "BAD_NAME";
        throw err;
      }
      const participants = room.participants || (room.participants = {});
      if (Object.keys(participants).length >= 10) {
        const err = new Error("room full");
        err.code = "ROOM_FULL";
        throw err;
      }
      if (Object.values(participants).some((p) => p.name.toLowerCase() === cleanName.toLowerCase() && p.status !== "stopped")) {
        const err = new Error("duplicate name");
        err.code = "DUPLICATE_NAME";
        throw err;
      }
      const pId = participantId(participants);
      const secret = participantSecret();
      participants[pId] = { name: cleanName, secret, checks: {}, status: "active", joinedAt: now };
      backup();
      write(row);
      return { participantId: pId, secret, room };
    },
    updateRoomParticipant(code, participantId, update, now = Date.now()) {
      const row = normalize(read());
      cleanupRooms(row, now);
      const room = row.rooms[String(code || "").toUpperCase()];
      if (!room || !room.participants || !room.participants[participantId]) return null;
      const participant = room.participants[participantId];
      update(participant, room);
      backup();
      write(row);
      return room;
    },
    backup,
    close() {},
  };
}
