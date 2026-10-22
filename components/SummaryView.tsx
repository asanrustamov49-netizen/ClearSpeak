"use client";

import { AlertIcon, ArrowRightIcon, BookmarkIcon, RefreshIcon } from "./icons";
import styles from "./SummaryView.module.css";
import type { WordTools } from "./wordTools";
import type { SummaryState } from "@/hooks/useChatSession";
import { getScenario } from "@/lib/constants";
import type { GoalStatus, TopicId, VocabularyItem } from "@/lib/types";
import { normalizeWord } from "@/lib/vocabulary";

interface Props {
  summary: SummaryState;
  topic: TopicId;
  turns: number;
  sessionWords: VocabularyItem[];
  words: WordTools;
  onRetry: () => void;
  onBack: () => void;
  onNewSession: () => void;
}

const GOAL_TEXT: Record<Exclude<GoalStatus, "not_applicable">, { title: string; tone: string }> = {
  completed: { title: "Цель выполнена", tone: "ok" },
  partial: { title: "Цель выполнена частично", tone: "partial" },
  not_completed: { title: "Цель пока не выполнена", tone: "no" },
};

export function SummaryView({ summary, topic, turns, sessionWords, words, onRetry, onBack, onNewSession }: Props) {
  const scenario = getScenario(topic);

  // Session words (with notes) first, then words the summary found in the transcript.
  const allWords: Array<{ word: string; translation: string; note: string }> = [...sessionWords];
  const seen = new Set(sessionWords.map((item) => normalizeWord(item.word)));
  for (const item of summary.data?.newWords ?? []) {
    if (seen.has(normalizeWord(item.word))) continue;
    seen.add(normalizeWord(item.word));
    allWords.push({ ...item, note: "" });
  }
  const unsaved = allWords.filter((item) => !words.isSaved(item.word));

  return (
    <section className={styles.summary} aria-labelledby="summary-title">
      <p className={styles.eyebrow}>
        {scenario.emoji} {scenario.label}
      </p>
      <h1 id="summary-title" className={styles.title}>
        Итоги сессии
      </h1>

      <dl className={styles.stats}>
        <div className={styles.stat}>
          <dt>Ваших реплик</dt>
          <dd>{turns}</dd>
        </div>
        <div className={styles.stat}>
          <dt>Новых слов</dt>
          <dd>{allWords.length}</dd>
        </div>
      </dl>

      {summary.status === "loading" && (
        <div className={styles.loading} role="status">
          <span className={styles.spinner} aria-hidden="true" />
          Анализируем разговор…
        </div>
      )}

      {summary.status === "error" && (
        <div className={styles.error} role="alert">
          <AlertIcon />
          <div>
            <p className={styles.errorTitle}>Не удалось подготовить итоги</p>
            <p className={styles.errorText}>{summary.error} История разговора сохранена.</p>
          </div>
          <button type="button" className={styles.secondary} onClick={onRetry}>
            <RefreshIcon width={16} height={16} /> Повторить
          </button>
        </div>
      )}

      {summary.status === "ready" && summary.data && (
        <>
          {scenario.goal && summary.data.goal.status !== "not_applicable" && (
            <div className={`${styles.goal} ${styles[GOAL_TEXT[summary.data.goal.status].tone]}`}>
              <p className={styles.goalTitle}>{GOAL_TEXT[summary.data.goal.status].title}</p>
              <p className={styles.goalTask}>Задание: {scenario.goal}</p>
              {summary.data.goal.comment && <p className={styles.goalComment}>{summary.data.goal.comment}</p>}
            </div>
          )}

          <section className={styles.block} aria-labelledby="errors-title">
            <h2 id="errors-title" className={styles.blockTitle}>
              Главные ошибки
            </h2>
            {summary.data.topErrors.length === 0 ? (
              <p className={styles.muted}>Повторяющихся ошибок не найдено.</p>
            ) : (
              <ol className={styles.errors}>
                {summary.data.topErrors.map((item, index) => (
                  <li key={index} className={styles.errorItem}>
                    <p className={styles.wrong} lang="en">
                      {item.example}
                    </p>
                    <p className={styles.right} lang="en">
                      {item.corrected}
                    </p>
                    <p className={styles.muted}>{item.explanation}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className={styles.block} aria-labelledby="tip-title">
            <h2 id="tip-title" className={styles.blockTitle}>
              Совет на следующую практику
            </h2>
            <p className={styles.tip}>{summary.data.nextSessionTip}</p>
          </section>
        </>
      )}

      <section className={styles.block} aria-labelledby="words-title">
        <div className={styles.blockHead}>
          <h2 id="words-title" className={styles.blockTitle}>
            Новые слова
          </h2>
          {unsaved.length > 0 && words.canSave && (
            <button
              type="button"
              className={styles.link}
              onClick={() =>
                unsaved.forEach((item) =>
                  words.save({ word: item.word, translation: item.translation, note: item.note, source: "summary", topic }),
                )
              }
            >
              Сохранить все в словарь
            </button>
          )}
        </div>
        {allWords.length === 0 ? (
          <p className={styles.muted}>В этой сессии новых слов не было.</p>
        ) : (
          <ul className={styles.words}>
            {allWords.map((item) => {
              const saved = words.isSaved(item.word);
              return (
                <li key={normalizeWord(item.word)} className={styles.word}>
                  <span>
                    <span lang="en" className={styles.wordEn}>
                      {item.word}
                    </span>{" "}
                    — <span className={styles.muted}>{item.translation}</span>
                  </span>
                  <button
                    type="button"
                    className={styles.iconButton}
                    disabled={saved || !words.canSave}
                    onClick={() => words.save({ word: item.word, translation: item.translation, note: item.note, source: "summary", topic })}
                    aria-label={saved ? `«${item.word}» уже в словаре` : `Сохранить «${item.word}»`}
                  >
                    <BookmarkIcon width={15} height={15} filled={saved} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={onNewSession}>
          Новая сессия <ArrowRightIcon width={18} height={18} />
        </button>
        <button type="button" className={styles.secondary} onClick={onBack}>
          Вернуться к разговору
        </button>
      </div>
    </section>
  );
}
