// server/fatsecret.js — клиент FatSecret (OAuth2 scope basic: поиск продуктов + детали).
// Дневник (food_entries) недоступен на basic — это Premier. Используем базу продуктов.
const TOKEN_URL = "https://oauth.fatsecret.com/connect/token";
const API_URL = "https://platform.fatsecret.com/rest/server.api";

// Нутриенты на 100 г из списка порций FatSecret. Pure-функция (тестируется отдельно).
export function per100gFrom(servings) {
  const g = (servings || []).find(
    (s) => String(s.metric_serving_unit || "").toLowerCase() === "g" && Number(s.metric_serving_amount) > 0
  );
  if (!g) return null;
  const k = 100 / Number(g.metric_serving_amount);
  const r = (x) => Math.round(Number(x || 0) * k * 10) / 10;
  return {
    kcal: Math.round(Number(g.calories || 0) * k),
    p: r(g.protein),
    f: r(g.fat),
    c: r(g.carbohydrate),
  };
}

function asArray(x) {
  return Array.isArray(x) ? x : x ? [x] : [];
}

export function createFatSecret({ clientId, clientSecret, fetcher = fetch }) {
  let token = null;
  let tokenExp = 0;

  async function getToken() {
    const now = Date.now();
    if (token && now < tokenExp - 60000) return token;
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const res = await fetcher(TOKEN_URL, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials&scope=basic",
    });
    if (!res.ok) throw new Error("fatsecret token failed: " + res.status);
    const j = await res.json();
    token = j.access_token;
    tokenExp = now + (Number(j.expires_in) || 86400) * 1000;
    return token;
  }

  async function call(params) {
    const t = await getToken();
    const body = new URLSearchParams({ ...params, format: "json" }).toString();
    const res = await fetcher(API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const j = await res.json();
    if (j.error) throw new Error("fatsecret " + j.error.code + ": " + j.error.message);
    return j;
  }

  async function searchFoods(query) {
    const j = await call({ method: "foods.search", search_expression: query, max_results: "20" });
    const foods = asArray(j.foods && j.foods.food);
    return foods.map((f) => ({
      id: f.food_id,
      name: f.food_name,
      brand: f.brand_name || "",
      desc: f.food_description || "",
    }));
  }

  async function getFood(id) {
    const j = await call({ method: "food.get.v4", food_id: id });
    const food = j.food || {};
    const servings = asArray(food.servings && food.servings.serving);
    return {
      id: food.food_id,
      name: food.food_name,
      brand: food.brand_name || "",
      per100g: per100gFrom(servings),
    };
  }

  return { searchFoods, getFood, getToken };
}
