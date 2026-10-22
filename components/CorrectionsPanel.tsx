import { BookmarkIcon, CheckIcon } from "./icons";
import styles from "./CorrectionsPanel.module.css";
import { PracticePhrase } from "./PracticePhrase";
import type { PlaybackTools, WordTools } from "./wordTools";
import type { UiMessage } from "@/hooks/useChatSession";
import type { Correction, TopicId, VocabularyItem } from "@/lib/types";

interface Props {
  messages: UiMessage[];
  vocabulary: VocabularyItem[];
  topic: TopicId;
  words: WordTools;
  audio: PlaybackTools;
}

function CorrectionList({ items, idPrefix, audio }: { items: Correction[]; idPrefix: string; audio: PlaybackTools }) {
  return (
    <ul className={styles.list}>
      {items.map((item, index) => (
        <li key={index} className={styles.item}>
          <dl className={styles.pair}>
            <dt className={styles.label}>Original phrase</dt>
            <dd className={styles.original} lang="en">
              {item.original}
            </dd>
            <dt className={styles.label}>Corrected phrase</dt>
            <dd className={styles.corrected} lang="en">
              {item.corrected}
            </dd>
            <dt className={styles.label}>Explanation</dt>
            <dd className={styles.explanation}>{item.explanation}</dd>
          </dl>
          <PracticePhrase id={`${idPrefix}-${index}`} target={item.corrected} audio={audio} />
        </li>
      ))}
    </ul>
  );
}

export function CorrectionsPanel({ messages, vocabulary, topic, words, audio }: Props) {
  const reviewed = messages.filter(
    (message): message is UiMessage & { corrections: Correction[] } => message.role === "user" && Array.isArray(message.corrections),
  );
  const latest = reviewed[reviewed.length - 1];
  const earlier = reviewed.slice(0, -1).filter((message) => message.corrections.length > 0).reverse();

  return (
    <div className={styles.panel}>
      <section id="corrections" className={styles.section} aria-labelledby="corrections-title" tabIndex={-1}>
        <h2 id="corrections-title" className={styles.title}>
          Исправления
        </h2>

        {!latest && <p className={styles.empty}>Здесь появятся исправления после вашего первого ответа.</p>}

        {latest && (
          <div aria-live="polite">
            <p className={styles.quote} lang="en">
              «{latest.content}»
            </p>
            {latest.corrections.length === 0 ? (
              <p className={styles.clean}>
                <CheckIcon width={18} height={18} />
                Ошибок не найдено — отлично звучит!
              </p>
            ) : (
              <CorrectionList items={latest.corrections} idPrefix={latest.id} audio={audio} />
            )}
          </div>
        )}

        {earlier.length > 0 && (
          <details className={styles.history}>
            <summary>Предыдущие исправления ({earlier.length})</summary>
            {earlier.map((message) => (
              <div key={message.id} className={styles.historyItem}>
                <p className={styles.quote} lang="en">
                  «{message.content}»
                </p>
                <CorrectionList items={message.corrections} idPrefix={message.id} audio={audio} />
              </div>
            ))}
          </details>
        )}
      </section>

      <section className={styles.section} aria-labelledby="vocab-title">
        <h2 id="vocab-title" className={styles.title}>
          Слова этой сессии <span className={styles.count}>{vocabulary.length}</span>
        </h2>
        {vocabulary.length === 0 ? (
          <p className={styles.empty}>Новые слова из ответов ИИ будут собираться здесь и не пропадут до конца сессии.</p>
        ) : (
          <ul className={styles.vocab}>
            {vocabulary.map((item) => {
              const saved = words.isSaved(item.word);
              return (
                <li key={item.word.toLowerCase()} className={styles.word}>
                  <span className={styles.wordText}>
                    <span lang="en" className={styles.wordEn}>
                      {item.word}
                    </span>
                    <span className={styles.wordRu}>{item.translation}</span>
                  </span>
                  <button
                    type="button"
                    className={`${styles.save} ${saved ? styles.saved : ""}`}
                    disabled={saved || !words.canSave}
                    onClick={() =>
                      words.save({ word: item.word, translation: item.translation, note: item.note, source: "lesson", topic })
                    }
                    aria-label={saved ? `«${item.word}» уже в словаре` : `Сохранить «${item.word}»`}
                    title={saved ? "Уже в словаре" : "Сохранить в словарь"}
                  >
                    <BookmarkIcon width={14} height={14} filled={saved} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
