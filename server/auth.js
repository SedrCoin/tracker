import { timingSafeEqual } from "node:crypto";

export function extractBearer(headerValue) {
  if (!headerValue) return null;
  const m = /^Bearer\s+(.+)$/i.exec(headerValue);
  return m ? m[1] : null;
}

export function tokenMatches(expected, provided) {
  if (typeof provided !== "string") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false; // timingSafeEqual требует равной длины
  return timingSafeEqual(a, b);
}
