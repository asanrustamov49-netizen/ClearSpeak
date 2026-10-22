"use client";

import { useEffect, useRef, useState } from "react";

import styles from "./DictionaryDialog.module.css";
import { CheckIcon, CloseIcon, DownloadIcon, SpeakerIcon } from "./icons";
import type { PlaybackTools } from "./wordTools";
import { progressActions, type ProgressState } from "@/hooks/useProgress";
import { getScenario } from "@/lib/constants";
import { wordsToAnki, wordsToCsv } from "@/lib/export";
import { dueWords, localDateKey, type SavedWord } from "@/lib/progress";

export type DictionaryMode = "list" | "review";

interface Props {
  open: boolean;
  mode: DictionaryMode;
  onModeChange: (mode: DictionaryMode) => void;
  onClose: () => void;
  progress: ProgressState | null;
  audio: PlaybackTools;
}

function download(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const SOURCE_LABEL: Record<SavedWord["source"], string> = {
  lesson: "из ответа ИИ",
  tap: "перевод по нажатию",
  summary: "из итогов",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
}

export function DictionaryDialog({ open, mode, onModeChange, onClose, progress, audio }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [exportMessage, setExportMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  // Review session: a fixed queue taken when review starts, so marking words does not reshuffle it.
  const [queue, setQueue] = useState<string[] | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const words = progress?.data.words ?? [];
  const sorted = [...words].reverse();
  const reviewQueue = queue ?? (mode === "review" && progress ? dueWords(progress.data, new Date()).map((word) => word.id) : []);
  const currentId = reviewQueue[index];
  const current = words.find((word) => word.id === currentId);

  const startReview = () => {
    setQueue(progress ? dueWords(progress.data, new Date()).map((word) => word.id) : []);
    setIndex(0);
    setRevealed(false);
    onModeChange("review");
  };

  const next = (remembered: boolean) => {
    if (current && remembered) progressActions.markReviewed(current.id);
    setQueue(reviewQueue);
    setIndex((value) => value + 1);
    setRevealed(false);
  };

  const exportAs = (format: "csv" | "anki") => {
    if (words.length === 0) {
      setExportMessage({ ok: false, text: "Словарь пуст — экспортировать нечего." });
      return;
    }
    try {
      const date = localDateKey(new Date());
      if (format === "csv") download(`speakup-words-${date}.csv`, wordsToCsv(words), "text/csv;charset=utf-8");
      else download(`speakup-anki-${date}.txt`, wordsToAnki(words), "text/plain;charset=utf-8");
      setExportMessage({
        ok: true,
        text:
          format === "csv"
            ? `CSV-файл сформирован: ${words.length} слов(а).`
            : `Файл для Anki сформирован: ${words.length} слов(а). В Anki: Файл → Импорт.`,
      });
    } catch {
      setExportMessage({ ok: false, text: "Не удалось сформировать файл. Попробуйте ещё раз." });
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="dictionary-title"
      onClose={() => {
        setQueue(null);
        setConfirmId(null);
        setExportMessage(null);
        onClose();
      }}
    >
      <header className={styles.header}>
        <h2 id="dictionary-title" className={styles.title}>
          Мой словарь <span className={styles.count}>{words.length}</span>
        </h2>
        <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Закрыть словарь">
          <CloseIcon />
        </button>
      </header>

      <div className={styles.tabs} role="tablist" aria-label="Режим словаря">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "list"}
          className={styles.tab}
          onClick={() => {
            setQueue(null);
            onModeChange("list");
          }}
        >
          Все слова
        </button>
        <button type="button" role="tab" aria-selected={mode === "review"} className={styles.tab} onClick={startReview}>
          Повторение
        </button>
      </div>

      {!progress && <p className={styles.muted}>Загружаем словарь…</p>}

      {progress && mode === "list" && (
        <div className={styles.body}>
          <div className={styles.exportRow}>
            <button type="button" className={styles.secondary} onClick={() => exportAs("csv")} disabled={words.length === 0}>
              <DownloadIcon width={16} height={16} /> CSV
            </button>
            <button type="button" className={styles.secondary} onClick={() => exportAs("anki")} disabled={words.length === 0}>
              <DownloadIcon width={16} height={16} /> Anki
            </button>
            {exportMessage && (
              <p className={exportMessage.ok ? styles.success : styles.warn} role="status">
                {exportMessage.text}
              </p>
            )}
          </div>

          {words.length === 0 ? (
            <p className={styles.empty}>
              Словарь пуст. Сохраняйте слова кнопкой с закладкой над ответами ИИ или нажимайте на незнакомые слова в
              сообщениях.
            </p>
          ) : (
            <ul className={styles.list}>
              {sorted.map((word) => (
                <li key={word.id} className={styles.item}>
                  <div className={styles.itemMain}>
                    <p className={styles.word} lang="en">
                      {word.word}
                    </p>
                    <p className={styles.translation}>{word.translation}</p>
                    {word.note && <p className={styles.muted}>{word.note}</p>}
                    {word.context && (
                      <p className={styles.context} lang="en">
                        «{word.context}»
                      </p>
                    )}
                    <p className={styles.meta}>
                      {formatDate(word.addedAt)} · {SOURCE_LABEL[word.source]}
                      {word.topic ? ` · ${getScenario(word.topic).label}` : ""}
                      {word.reviews.length > 0 ? ` · повторено ${word.reviews.length}×` : ""}
                    </p>
                  </div>
                  <div className={styles.itemActions}>
                    {audio.available && (
                      <button
                        type="button"
                        className={styles.iconButton}
                        onClick={() => audio.play(`dict:${word.id}`, word.word)}
                        aria-label={`Прослушать «${word.word}»`}
                      >
                        <SpeakerIcon width={16} height={16} />
                      </button>
                    )}
                    {confirmId === word.id ? (
                      <button
                        type="button"
                        className={styles.danger}
                        onClick={() => {
                          progressActions.removeWord(word.id);
                          setConfirmId(null);
                        }}
                      >
                        Удалить?
                      </button>
                    ) : (
                      <button type="button" className={styles.ghost} onClick={() => setConfirmId(word.id)}>
                        Убрать
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {progress && mode === "review" && (
        <div className={styles.body}>
          {reviewQueue.length === 0 ? (
            <p className={styles.empty}>
              Сейчас нечего повторять. Слова из прошлых дней появятся здесь по графику: через 1, 2, 4, 7… дней.
            </p>
          ) : !current ? (
            <div className={styles.done}>
              <CheckIcon width={28} height={28} />
              <p>Повторение завершено!</p>
              <button type="button" className={styles.secondary} onClick={onClose}>
                Закрыть
              </button>
            </div>
          ) : (
            <div className={styles.card}>
              <p className={styles.progressText}>
                {index + 1} из {reviewQueue.length}
              </p>
              <p className={styles.cardWord} lang="en">
                {current.word}
              </p>
              {audio.available && (
                <button type="button" className={styles.ghost} onClick={() => audio.play(`review:${current.id}`, current.word)}>
                  <SpeakerIcon width={16} height={16} /> Произношение
                </button>
              )}
              {revealed ? (
                <>
                  <p className={styles.cardTranslation}>{current.translation}</p>
                  {current.context && (
                    <p className={styles.context} lang="en">
                      «{current.context}»
                    </p>
                  )}
                  <div className={styles.cardActions}>
                    <button type="button" className={styles.primary} onClick={() => next(true)}>
                      <CheckIcon width={16} height={16} /> Повторено
                    </button>
                    <button type="button" className={styles.secondary} onClick={() => next(false)}>
                      Ещё учу
                    </button>
                  </div>
                </>
              ) : (
                <button type="button" className={styles.primary} onClick={() => setRevealed(true)}>
                  Показать перевод
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}
