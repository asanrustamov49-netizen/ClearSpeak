"use client";
import { useEffect, useRef, useState } from "react";
import styles from "./AssistantMessage.module.css";
import { BookmarkIcon, CloseIcon, RefreshIcon, SpeakerIcon, StopIcon } from "./icons";
import { WordChips } from "./WordChips";
import type { PlaybackTools, WordTools } from "./wordTools";
import type { UiMessage } from "@/hooks/useChatSession";
import { ChatApiError, postTranslate } from "@/lib/api";
import { SLOW_SPEECH_RATE } from "@/lib/constants";
import { sentenceAround, tokenizeMessage } from "@/lib/tokenize";
import type { TopicId } from "@/lib/types";
import { normalizeWord } from "@/lib/vocabulary";

const translationCache = new Map<string, { translation: string; note: string }>();

interface Props {
  message: UiMessage;
  topic: TopicId;
  words: WordTools;
  audio: PlaybackTools;
}

type Lookup =
  | { status: "loading" }
  | { status: "ready"; translation: string; note: string }
  | { status: "error"; message: string };

export function AssistantMessage({ message, topic, words, audio }: Props) {
  const [selected, setSelected] = useState<{ phrase: string; context: string } | null>(null);
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [savedNow, setSavedNow] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const vocabulary = message.vocabulary ?? [];
  const tokens = tokenizeMessage(message.content, vocabulary.map((item) => item.word));

  const fetchTranslation = (phrase: string, context: string) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLookup({ status: "loading" });
    postTranslate({ level: words.level, phrase, context }, controller.signal)
      .then((result) => {
        translationCache.set(normalizeWord(phrase), { translation: result.translation, note: result.note });
        if (!controller.signal.aborted) setLookup({ status: "ready", translation: result.translation, note: result.note });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLookup({
          status: "error",
          message: error instanceof ChatApiError ? error.message : "Не удалось получить перевод.",
        });
      });
  };

  const openPhrase = (phrase: string) => {
    const context = sentenceAround(message.content, phrase);
    setSelected({ phrase, context });
    setSavedNow(false);
    const known =
      vocabulary.find((item) => normalizeWord(item.word) === normalizeWord(phrase)) ??
      words.lookup(phrase) ??
      translationCache.get(normalizeWord(phrase));
    if (known) {
      controllerRef.current?.abort();
      setLookup({ status: "ready", translation: known.translation, note: known.note });
      return;
    }
    fetchTranslation(phrase, context);
  };

  const close = () => {
    controllerRef.current?.abort();
    setSelected(null);
    setLookup(null);
  };

  const playId = message.id;
  const slowId = `${message.id}:slow`;
  const current = audio.playback;
  const isMain = current?.id === playId;
  const isSlow = current?.id === slowId;

  const alreadySaved = selected ? words.isSaved(selected.phrase) : false;

  return (
    <div className={styles.wrap}>
      <WordChips messageId={message.id} items={vocabulary} context={message.content} topic={topic} words={words} audio={audio} />

      <div className={styles.bubble}>
        <p className="visually-hidden" lang="en">
          SpeakUp AI: {message.content}
        </p>
        <p className={styles.text} lang="en" aria-hidden="true">
          {tokens.map((token, index) =>
            token.kind === "text" ? (
              <span key={index}>{token.value}</span>
            ) : (
              <button
                key={index}
                type="button"
                tabIndex={-1}
                className={`${styles.word} ${token.kind === "phrase" ? styles.phrase : ""} ${
                  selected && normalizeWord(selected.phrase) === normalizeWord(token.kind === "phrase" ? token.key : token.value)
                    ? styles.wordActive
                    : ""
                }`}
                onClick={() => openPhrase(token.kind === "phrase" ? token.key : token.value)}
              >
                {token.value}
              </button>
            ),
          )}
        </p>

        {selected && (
          <div className={styles.lookup} role="region" aria-label={`Перевод: ${selected.phrase}`} aria-live="polite">
            <div className={styles.lookupHead}>
              <span className={styles.lookupWord} lang="en">
                {selected.phrase}
              </span>
              <button type="button" className={styles.iconButton} onClick={close} aria-label="Закрыть перевод">
                <CloseIcon width={16} height={16} />
              </button>
            </div>
            {lookup?.status === "loading" && <p className={styles.muted}>Переводим…</p>}
            {lookup?.status === "error" && (
              <p className={styles.lookupError}>
                {lookup.message}{" "}
                <button type="button" className={styles.linkButton} onClick={() => fetchTranslation(selected.phrase, selected.context)}>
                  <RefreshIcon width={14} height={14} /> Повторить
                </button>
              </p>
            )}
            {lookup?.status === "ready" && (
              <>
                <p className={styles.lookupTranslation}>{lookup.translation}</p>
                {lookup.note && <p className={styles.muted}>{lookup.note}</p>}
                <div className={styles.lookupActions}>
                  {audio.available && (
                    <button
                      type="button"
                      className={styles.pill}
                      onClick={() => audio.play(`tap:${message.id}:${selected.phrase}`, selected.phrase)}
                    >
                      <SpeakerIcon width={14} height={14} /> Произношение
                    </button>
                  )}
                  <button
                    type="button"
                    className={styles.pill}
                    disabled={alreadySaved || !words.canSave}
                    onClick={() => {
                      const added = words.save({
                        word: selected.phrase,
                        translation: lookup.translation,
                        note: lookup.note,
                        context: selected.context,
                        source: "tap",
                        topic,
                      });
                      setSavedNow(added);
                    }}
                  >
                    <BookmarkIcon width={14} height={14} filled={alreadySaved} />
                    {alreadySaved ? (savedNow ? "Добавлено в словарь" : "Уже в словаре") : "В словарь"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {audio.available && (
          <div className={styles.controls}>
            <button
              type="button"
              className={styles.pill}
              aria-pressed={isMain}
              onClick={() => (isMain ? audio.stop() : audio.play(playId, message.content))}
            >
              {isMain ? <StopIcon width={14} height={14} /> : <SpeakerIcon width={14} height={14} />}
              {isMain ? (current?.status === "loading" ? "Загрузка…" : "Остановить") : "Прослушать"}
            </button>
            <button
              type="button"
              className={styles.pill}
              aria-pressed={isSlow}
              onClick={() => (isSlow ? audio.stop() : audio.play(slowId, message.content, { rate: SLOW_SPEECH_RATE }))}
              aria-label={isSlow ? "Остановить медленное воспроизведение" : "Прослушать медленно, 0.7×"}
              title="Медленно, 0.7×"
            >
              <span aria-hidden="true">🐢</span>
              {isSlow ? (current?.status === "loading" ? "Загрузка…" : "Стоп") : "0.7×"}
            </button>
            {(isMain || isSlow) && current?.status === "playing" && (
              <span className={styles.engine}>{audio.engineLabel(current.engine)}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
