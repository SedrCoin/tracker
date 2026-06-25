import { test } from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter } from "../rateLimit.js";

test("пропускает до лимита, блокирует сверх, сбрасывается через окно", () => {
  let now = 0;
  const clock = () => now;
  const limit = createRateLimiter({ max: 3, windowMs: 1000, clock });
  assert.equal(limit("ip1"), true);
  assert.equal(limit("ip1"), true);
  assert.equal(limit("ip1"), true);
  assert.equal(limit("ip1"), false); // 4-й в окне — блок
  assert.equal(limit("ip2"), true); // другой IP не затронут
  now = 1001; // окно прошло
  assert.equal(limit("ip1"), true);
});
