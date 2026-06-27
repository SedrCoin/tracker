// Возвращают строки SVG. points: [{date, value}].

export function lineChart(points, color = "#1cb0f6", w = 320, h = 140) {
  if (points.length === 0) return `<div class="chart-empty">Пока нет данных</div>`;
  const pad = 28;
  const xs = points.map((_, i) =>
    pad + (i * (w - 2 * pad)) / Math.max(1, points.length - 1)
  );
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const chartBottom = h - pad;
  const chartTop = 18;
  const y = (v) => chartBottom - ((v - min) / span) * (chartBottom - chartTop);
  const d = points
    .map((p, i) => `${i ? "L" : "M"}${xs[i].toFixed(1)},${y(p.value).toFixed(1)}`)
    .join(" ");
  const grid = [0, 0.5, 1]
    .map((t) => {
      const yy = chartBottom - t * (chartBottom - chartTop);
      return `<line x1="${pad}" y1="${yy.toFixed(1)}" x2="${w - pad}" y2="${yy.toFixed(1)}" class="chart-grid" />`;
    })
    .join("");
  const dots = points
    .map(
      (p, i) =>
        `<circle cx="${xs[i].toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3.5" fill="${color}" />`
    )
    .join("");
  const labels = points
    .map(
      (p, i) =>
        `<text x="${xs[i].toFixed(1)}" y="${(y(p.value) - 8).toFixed(1)}" font-size="9" fill="${color}" text-anchor="middle" font-weight="700">${p.value}</text>`
    )
    .join("");
  const xLabels = points
    .map(
      (p, i) =>
        `<text x="${xs[i].toFixed(1)}" y="${h - 5}" class="chart-x" text-anchor="middle">${p.label || ""}</text>`
    )
    .join("");
  return `<svg viewBox="0 0 ${w} ${h}" class="chart">
    ${grid}
    <path d="${d}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    ${dots}${labels}${xLabels}</svg>`;
}

export function barChart(points, color = "#58cc02", w = 320, h = 140) {
  if (points.length === 0) return `<div class="chart-empty">Пока нет данных</div>`;
  const pad = 28;
  const max = Math.max(...points.map((p) => p.value)) || 1;
  const gap = (w - 2 * pad) / points.length;
  const bw = Math.min(20, gap * 0.58);
  const chartBottom = h - pad;
  const chartTop = 18;
  const grid = [0, 0.5, 1]
    .map((t) => {
      const yy = chartBottom - t * (chartBottom - chartTop);
      return `<line x1="${pad}" y1="${yy.toFixed(1)}" x2="${w - pad}" y2="${yy.toFixed(1)}" class="chart-grid" />`;
    })
    .join("");
  const bars = points
    .map((p, i) => {
      const bh = Math.max(p.value > 0 ? 3 : 0, (p.value / max) * (chartBottom - chartTop));
      const x = pad + i * gap + (gap - bw) / 2;
      const yTop = chartBottom - bh;
      const cx = x + bw / 2;
      return `<rect x="${x.toFixed(1)}" y="${yTop.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="6" fill="${color}" />
        <text x="${cx.toFixed(1)}" y="${(yTop - 4).toFixed(1)}" font-size="10" fill="${color}" text-anchor="middle" font-weight="700">${p.value || ""}</text>
        <text x="${cx.toFixed(1)}" y="${h - 5}" class="chart-x" text-anchor="middle">${p.label || ""}</text>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${w} ${h}" class="chart">${grid}<line x1="${pad}" y1="${chartBottom}" x2="${w - pad}" y2="${chartBottom}" class="chart-axis" />${bars}</svg>`;
}
