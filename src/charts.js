// Возвращают строки SVG. points: [{date, value}].

export function lineChart(points, color = "#1cb0f6", w = 320, h = 140) {
  if (points.length === 0) return `<div class="chart-empty">Пока нет данных</div>`;
  const pad = 24;
  const xs = points.map((_, i) =>
    pad + (i * (w - 2 * pad)) / Math.max(1, points.length - 1)
  );
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const y = (v) => h - pad - ((v - min) / span) * (h - 2 * pad);
  const d = points
    .map((p, i) => `${i ? "L" : "M"}${xs[i].toFixed(1)},${y(p.value).toFixed(1)}`)
    .join(" ");
  const dots = points
    .map(
      (p, i) =>
        `<circle cx="${xs[i].toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3.5" fill="${color}" />`
    )
    .join("");
  const labels = points
    .map(
      (p, i) =>
        `<text x="${xs[i].toFixed(1)}" y="${(y(p.value) - 8).toFixed(1)}" font-size="9" fill="${color}" text-anchor="middle">${p.value}</text>`
    )
    .join("");
  return `<svg viewBox="0 0 ${w} ${h}" class="chart">
    <path d="${d}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    ${dots}${labels}</svg>`;
}

export function barChart(points, color = "#58cc02", w = 320, h = 140) {
  if (points.length === 0) return `<div class="chart-empty">Пока нет данных</div>`;
  const pad = 24;
  const max = Math.max(...points.map((p) => p.value)) || 1;
  const gap = (w - 2 * pad) / points.length;
  const bw = gap * 0.7;
  const bars = points
    .map((p, i) => {
      const bh = (p.value / max) * (h - 2 * pad);
      const x = pad + i * gap + gap * 0.15;
      const yTop = h - pad - bh;
      return `<rect x="${x.toFixed(1)}" y="${yTop.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="${color}" />
        <text x="${(x + bw / 2).toFixed(1)}" y="${(yTop - 4).toFixed(1)}" font-size="10" fill="${color}" text-anchor="middle" font-weight="700">${p.value}</text>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${w} ${h}" class="chart">${bars}</svg>`;
}
