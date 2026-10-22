import type { SavedWord } from "./progress";

/** Prevents spreadsheet apps from evaluating a cell as a formula (CSV injection). */
function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function csvCell(value: string): string {
  const safe = neutralizeFormula(value);
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

/** CSV (RFC 4180, CRLF) with a UTF-8 BOM so Excel opens Cyrillic correctly. */
export function wordsToCsv(words: readonly SavedWord[]): string {
  const header = ["English", "Russian", "Example", "Context", "Added"];
  const rows = words.map((word) => [word.word, word.translation, word.note, word.context, dateOnly(word.addedAt)]);
  return "﻿" + [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

function ankiField(value: string): string {
  // Tabs/newlines would break the row structure; quotes are escaped the way Anki's importer expects.
  const flat = value.replace(/[\t\r\n]+/g, " ").trim();
  return flat.includes('"') ? `"${flat.replace(/"/g, '""')}"` : flat;
}

/**
 * Anki plain-text import format with file headers (https://docs.ankiweb.net/importing/text-files.html):
 * UTF-8, tab-separated, one note per line, English on the front, Russian on the back.
 */
export function wordsToAnki(words: readonly SavedWord[]): string {
  const lines = [
    "#separator:Tab",
    "#html:false",
    "#tags:speakup",
    "#columns:English\tRussian\tExample\tAdded",
    ...words.map((word) => [word.word, word.translation, word.note || word.context, dateOnly(word.addedAt)].map(ankiField).join("\t")),
  ];
  return lines.join("\n") + "\n";
}
