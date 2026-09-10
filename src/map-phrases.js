export const MAX_PHRASE_LENGTH = 30;
export const PHRASE_BACKGROUND = "#96c46e";
export const DEFAULT_PHRASES = ["Ты смог", "Твоя сила", "День за днём"];

export function validateMapPhrase(value) {
  const raw = String(value ?? "").normalize("NFC").replace(/[\uD800-\uDFFF]/gu, "\uFFFD").replace(/[\u0000-\u001f\u007f\uFFFE\uFFFF]/g, " ");
  const length = Array.from(raw).length;
  const text = raw.trim().replace(/\s+/g, " ");
  const error = length > MAX_PHRASE_LENGTH
    ? `Максимум ${MAX_PHRASE_LENGTH} символов, включая пробелы.`
    : !text ? "Напиши свою фразу." : "";
  return { text, length, error, valid: !error };
}

const escapeXml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[char]));

// Break on words when possible, and safely wrap a long word without clipping it.
export function layoutMapPhrase(value) {
  const validation = validateMapPhrase(value);
  if (!validation.valid) throw new RangeError(validation.error);
  const lines = [];
  let line = "";
  for (const word of validation.text.split(" ")) {
    const chars = Array.from(word);
    const chunks = [];
    while (chars.length) chunks.push(chars.splice(0, 12).join(""));
    for (const chunk of chunks) {
      const candidate = line ? `${line} ${chunk}` : chunk;
      if (Array.from(candidate).length > 12) {
        if (line) lines.push(line);
        line = chunk;
      } else line = candidate;
    }
  }
  if (line) lines.push(line);
  const width = (line) => Array.from(line).reduce((sum, char) => {
    if (/[ЖШЩЮМW@%]/i.test(char)) return sum + 1;
    if (/[.,!:';|ilІ]/.test(char)) return sum + .32;
    if (char === " ") return sum + .33;
    return sum + (/[^\p{L}\p{N}]/u.test(char) ? 1.1 : .72);
  }, 0);
  const fontSize = Math.min(92, Math.floor(590 / Math.max(...lines.map(width))));
  const lineHeight = Math.round(fontSize * 1.3);
  return { text: validation.text, lines, fontSize, lineHeight, firstBaseline: 400 - (lines.length - 1) * lineHeight / 2 + fontSize * .34 };
}

// Typography is drawn once and revealed in tiles, just like the landscape.
// Escaping XML before URI encoding keeps custom text inert in both SVG and CSS.
export function phraseArtwork(value) {
  const layout = layoutMapPhrase(value);
  const lines = layout.lines.map((line, index) => `<text x="400" y="${layout.firstBaseline + index * layout.lineHeight}">${escapeXml(line)}</text>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800"><rect width="800" height="800" fill="${PHRASE_BACKGROUND}"/><g fill="#244638" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${layout.fontSize}" text-anchor="middle">${lines}</g></svg>`;
  return { name: layout.text, image: `data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, "%27")}` };
}
