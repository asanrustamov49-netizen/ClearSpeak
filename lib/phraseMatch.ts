import { normalizeForMatch } from "./validation.ts";

export interface PhraseComparison {
  score: number;
  verdict: "match" | "close" | "different";
  missing: string[];
  extra: string[];
}

function words(text: string): string[] {
  return normalizeForMatch(text).replace(/['-]/g, " ").split(" ").filter(Boolean);
}

export function comparePhrase(target: string, recognized: string): PhraseComparison {
  const a = words(target);
  const b = words(recognized);
  if (a.length === 0) return { score: 0, verdict: "different", missing: [], extra: b };

  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  const distance = dp[a.length][b.length];
  const score = Math.max(0, 1 - distance / Math.max(a.length, b.length));

  const bSet = new Set(b);
  const aSet = new Set(a);
  const missing = [...new Set(a.filter((word) => !bSet.has(word)))];
  const extra = [...new Set(b.filter((word) => !aSet.has(word)))];

  const verdict = distance === 0 || score >= 0.9 ? "match" : score >= 0.6 ? "close" : "different";
  return { score, verdict, missing, extra };
}
