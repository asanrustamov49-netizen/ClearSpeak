"use client";

import { BookmarkIcon, SpeakerIcon } from "./icons";
import styles from "./WordChips.module.css";
import type { PlaybackTools, WordTools } from "./wordTools";
import type { TopicId, VocabularyItem } from "@/lib/types";

interface Props {
  messageId: string;
  items: VocabularyItem[];
  context: string;
  topic: TopicId;
  words: WordTools;
  audio: PlaybackTools;
}

/** New words introduced by one AI reply, shown right above it. */
export function WordChips({ messageId, items, context, topic, words, audio }: Props) {
  if (items.length === 0) {
    return <p className={styles.empty}>Новых слов в этом ответе нет</p>;
  }

  return (
    <ul className={styles.list} aria-label="Новые слова в этом ответе">
      {items.map((item) => {
        const saved = words.isSaved(item.word);
        const playId = `word:${messageId}:${item.word}`;
        const playing = audio.playback?.id === playId;
        return (
          <li key={item.word} className={styles.chip}>
            <div className={styles.text}>
              <span className={styles.word} lang="en">
                {item.word}
              </span>
              <span className={styles.translation}>{item.translation}</span>
              {item.note && <span className={styles.note}>{item.note}</span>}
            </div>
            <div className={styles.actions}>
              {audio.available && (
                <button
                  type="button"
                  className={styles.icon}
                  onClick={() => (playing ? audio.stop() : audio.play(playId, item.word))}
                  aria-label={`Прослушать «${item.word}»`}
                  aria-pressed={playing}
                  title="Прослушать"
                >
                  <SpeakerIcon width={15} height={15} />
                </button>
              )}
              <button
                type="button"
                className={`${styles.icon} ${saved ? styles.saved : ""}`}
                disabled={saved || !words.canSave}
                onClick={() =>
                  words.save({
                    word: item.word,
                    translation: item.translation,
                    note: item.note,
                    context,
                    source: "lesson",
                    topic,
                  })
                }
                aria-label={saved ? `«${item.word}» уже в словаре` : `Сохранить «${item.word}» в словарь`}
                title={saved ? "Уже в словаре" : "Сохранить в словарь"}
              >
                <BookmarkIcon width={15} height={15} filled={saved} />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
