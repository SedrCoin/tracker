import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenMatches, extractBearer } from "../auth.js";

test("extractBearer вытаскивает токен", () => {
  assert.equal(extractBearer("Bearer abc"), "abc");
  assert.equal(extractBearer("bearer abc"), "abc");
  assert.equal(extractBearer(undefined), null);
  assert.equal(extractBearer("Basic x"), null);
});

test("tokenMatches сравнивает корректно", () => {
  assert.equal(tokenMatches("secret", "secret"), true);
  assert.equal(tokenMatches("secret", "secre"), false);
  assert.equal(tokenMatches("secret", "wrongg"), false);
  assert.equal(tokenMatches("secret", null), false);
});
