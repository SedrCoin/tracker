// Фиксированное окно по IP. clock инъектируется для тестов.
export function createRateLimiter({ max, windowMs, clock = Date.now }) {
  const hits = new Map(); // ip -> { count, windowStart }
  return function allow(ip) {
    const now = clock();
    const rec = hits.get(ip);
    if (!rec || now - rec.windowStart >= windowMs) {
      hits.set(ip, { count: 1, windowStart: now });
      return true;
    }
    if (rec.count >= max) return false;
    rec.count += 1;
    return true;
  };
}
