"use client";
import styles from "./ProgressCards.module.css";
import type { ProgressState } from "@/hooks/useProgress";
import { computeStreak, dueWords } from "@/lib/progress";

interface Props {
  progress: ProgressState | null;
  onReview: () => void;
  onOpenDictionary: () => void;
}

function daysWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "день";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "дня";
  return "дней";
}

export function ProgressCards({ progress, onReview, onOpenDictionary }: Props) {
  if (!progress) {
    return <div className={styles.placeholder} aria-hidden="true" />;
  }

  const now = new Date();
  const { data } = progress;
  const hasPractice = data.practiceDays.length > 0;
  const streak = computeStreak(data.practiceDays, now);
  const due = dueWords(data, now).length;

  return (
    <div className={styles.wrap}>
      <ul className={styles.cards} aria-label="Ваш прогресс">
        <li className={styles.card}>
          <span className={styles.value}>{hasPractice ? streak : "—"}</span>
          <span className={styles.label}>
            {hasPractice ? `${daysWord(streak)} подряд` : "Дней подряд: начните первое занятие"}
          </span>
        </li>
        <li className={styles.card}>
          <button type="button" className={styles.cardButton} onClick={onOpenDictionary}>
            <span className={styles.value}>{data.words.length}</span>
            <span className={styles.label}>Слов изучено</span>
          </button>
        </li>
        <li className={styles.card}>
          <button type="button" className={styles.cardButton} onClick={onReview} disabled={due === 0}>
            <span className={styles.value}>{due}</span>
            <span className={styles.label}>{due > 0 ? "Повторить слова" : "Повторить слова: пока нечего"}</span>
          </button>
        </li>
      </ul>
      {progress.storageError && <p className={styles.warn}>{progress.storageError}</p>}
    </div>
  );
}
