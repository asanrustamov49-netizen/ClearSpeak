/**
 * Reads the value of the FIRST top-level string field of a JSON object that is still being streamed,
 * e.g. `{"reply":"Hello, wel` → "Hello, wel". Used only for the provisional on-screen text while
 * a structured reply streams in; the final object is always parsed with JSON.parse and validated.
 *
 * Returns null until the field's opening quote has arrived, or if the object does not start with it.
 */
export function readStreamingStringField(partial: string, field: string): string | null {
  let i = 0;
  const skipSpace = () => {
    while (i < partial.length && /\s/.test(partial[i])) i += 1;
  };

  skipSpace();
  if (partial[i] !== "{") return null;
  i += 1;
  skipSpace();
  const key = JSON.stringify(field);
  if (!partial.startsWith(key, i)) return null;
  i += key.length;
  skipSpace();
  if (partial[i] !== ":") return null;
  i += 1;
  skipSpace();
  if (partial[i] !== '"') return null;
  i += 1;

  let out = "";
  while (i < partial.length) {
    const ch = partial[i];
    if (ch === '"') return out;
    if (ch !== "\\") {
      out += ch;
      i += 1;
      continue;
    }
    // Escape sequence: stop if it is not complete yet.
    const next = partial[i + 1];
    if (next === undefined) return out;
    if (next === "u") {
      const hex = partial.slice(i + 2, i + 6);
      if (hex.length < 4) return out;
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) return out;
      out += String.fromCharCode(parseInt(hex, 16));
      i += 6;
      continue;
    }
    const map: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
    out += map[next] ?? next;
    i += 2;
  }
  return out;
}
