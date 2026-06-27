import { test } from "node:test";
import assert from "node:assert/strict";
import { createFatSecret, per100gFrom } from "../fatsecret.js";

test("per100gFrom: граммовая порция 100г", () => {
  const s = [
    { metric_serving_unit: "g", metric_serving_amount: "100", calories: "89", protein: "1.09", fat: "0.33", carbohydrate: "22.84" },
  ];
  assert.deepEqual(per100gFrom(s), { kcal: 89, p: 1.1, f: 0.3, c: 22.8 });
});

test("per100gFrom: масштабирует порцию 50г к 100г", () => {
  const s = [
    { metric_serving_unit: "g", metric_serving_amount: "50", calories: "45", protein: "0.5", fat: "0.2", carbohydrate: "11" },
  ];
  assert.deepEqual(per100gFrom(s), { kcal: 90, p: 1, f: 0.4, c: 22 });
});

test("per100gFrom: берёт граммовую среди нескольких порций", () => {
  const s = [
    { metric_serving_unit: "oz", metric_serving_amount: "1" },
    { metric_serving_unit: "g", metric_serving_amount: "100", calories: "52", protein: "0.3", fat: "0.2", carbohydrate: "14" },
  ];
  assert.deepEqual(per100gFrom(s), { kcal: 52, p: 0.3, f: 0.2, c: 14 });
});

test("per100gFrom: нет граммовой порции → null", () => {
  assert.equal(per100gFrom([{ metric_serving_unit: "ml", metric_serving_amount: "100" }]), null);
  assert.equal(per100gFrom([]), null);
  assert.equal(per100gFrom(undefined), null);
});

test("createFatSecret добавляет русскую локаль в запросы", async () => {
  const bodies = [];
  const client = createFatSecret({
    clientId: "id",
    clientSecret: "secret",
    fetcher: async (url, opts) => {
      if (String(url).includes("/connect/token")) {
        return { ok: true, json: async () => ({ access_token: "token", expires_in: 3600 }) };
      }
      bodies.push(opts.body);
      return { ok: true, json: async () => ({ foods: { food: [] } }) };
    },
  });
  await client.searchFoods("творог");
  assert.match(bodies[0], /region=RU/);
  assert.match(bodies[0], /language=ru/);
  assert.match(bodies[0], /search_expression=%D1%82%D0%B2%D0%BE%D1%80%D0%BE%D0%B3/);
});
