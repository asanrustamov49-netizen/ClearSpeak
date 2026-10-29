export type TextToken =
  | { kind: "text"; value: string }
  | { kind: "word"; value: string }
  | { kind: "phrase"; value: string; key: string };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const WORD = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;

function splitWords(text: string, out: TextToken[]): void {
  let last = 0;
  for (const match of text.matchAll(WORD)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ kind: "text", value: text.slice(last, index) });
    out.push({ kind: "word", value: match[0] });
    last = index + match[0].length;
  }
  if (last < text.length) out.push({ kind: "text", value: text.slice(last) });
}

export function tokenizeMessage(text: string, phrases: readonly string[]): TextToken[] {
  const usable = [...new Set(phrases.map((p) => p.trim()).filter((p) => p.length > 0))].sort((a, b) => b.length - a.length);
  const tokens: TextToken[] = [];
  if (usable.length === 0) {
    splitWords(text, tokens);
    return tokens;
  }

  const pattern = new RegExp(`(?<![A-Za-z])(${usable.map(escapeRegExp).join("|")})(?![A-Za-z])`, "gi");
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) splitWords(text.slice(last, index), tokens);
    const key = usable.find((p) => p.toLowerCase() === match[0].toLowerCase()) ?? match[0];
    tokens.push({ kind: "phrase", value: match[0], key });
    last = index + match[0].length;
  }
  if (last < text.length) splitWords(text.slice(last), tokens);
  return tokens;
}

export function sentenceAround(text: string, phrase: string): string {
  const index = text.toLowerCase().indexOf(phrase.toLowerCase());
  if (index < 0) return text.slice(0, 300);
  const before = text.lastIndexOf(".", index);
  const startCandidates = [before, text.lastIndexOf("?", index), text.lastIndexOf("!", index)];
  const start = Math.max(...startCandidates) + 1;
  const endCandidates = [".", "?", "!"].map((ch) => text.indexOf(ch, index + phrase.length)).filter((i) => i >= 0);
  const end = endCandidates.length ? Math.min(...endCandidates) + 1 : text.length;
  return text.slice(start, end).trim();
}
