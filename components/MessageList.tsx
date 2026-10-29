"use client";
import { useEffect, useRef } from "react";
import { AssistantMessage } from "./AssistantMessage";
import { AlertIcon, CheckIcon, RefreshIcon } from "./icons";
import styles from "./MessageList.module.css";
import type { PlaybackTools, WordTools } from "./wordTools";
import type { SessionError, UiMessage } from "@/hooks/useChatSession";
import type { TopicId } from "@/lib/types";

interface Props {
  messages: UiMessage[];
  pending: "start" | "send" | null;
  streamingText: string | null;
  error: SessionError | null;
  onRetry: () => void;
  topic: TopicId;
  words: WordTools;
  audio: PlaybackTools;
}

function pluralizeFixes(count: number): string {
  if (count === 1) return "1 исправление";
  return `${count} исправления`;
}

function UserStatus({ message, isLast, pending, failed }: { message: UiMessage; isLast: boolean; pending: boolean; failed: boolean }) {
  if (message.corrections) {
    if (message.corrections.length === 0) {
      return (
        <span className={`${styles.status} ${styles.statusOk}`}>
          <CheckIcon width={14} height={14} /> Без ошибок
        </span>
      );
    }
    return (
      <a href="#corrections" className={`${styles.status} ${styles.statusFix}`}>
        {pluralizeFixes(message.corrections.length)}
      </a>
    );
  }
  if (isLast && pending) return <span className={styles.status}>Отправлено, ждём ответ…</span>;
  if (isLast && failed) return <span className={`${styles.status} ${styles.statusError}`}>Не доставлено</span>;
  return null;
}

export function MessageList({ messages, pending, streamingText, error, onRetry, topic, words, audio }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  const lastId = messages[messages.length - 1]?.id;

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    endRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "end" });
  }, [lastId, pending, error, streamingText]);

  return (
    <div className={styles.scroller}>
      <ol className={styles.list} role="log" aria-live="polite" aria-relevant="additions" aria-label="Диалог">
        {messages.map((message, index) => {
          const isLast = index === messages.length - 1;
          if (message.role === "assistant") {
            return (
              <li key={message.id} className={`${styles.row} ${styles.assistantRow}`}>
                <span className={styles.avatar} aria-hidden="true">
                  AI
                </span>
                <AssistantMessage message={message} topic={topic} words={words} audio={audio} />
              </li>
            );
          }
          return (
            <li key={message.id} className={`${styles.row} ${styles.userRow}`}>
              <div className={styles.userBubble}>
                <span className="visually-hidden">Вы: </span>
                <p className={styles.text} lang="en">
                  {message.content}
                </p>
              </div>
              <UserStatus message={message} isLast={isLast} pending={pending === "send"} failed={error?.action === "send"} />
            </li>
          );
        })}

        {pending && (
          <li className={`${styles.row} ${styles.assistantRow}`}>
            <span className={styles.avatar} aria-hidden="true">
              AI
            </span>
            {streamingText ? (
              <div className={`${styles.assistantBubble} ${styles.streaming}`} aria-busy="true">
                <p className={styles.text} lang="en">
                  {streamingText}
                  <span className={styles.caret} aria-hidden="true" />
                </p>
                <p className={styles.streamingNote}>Проверяем ответ и готовим исправления…</p>
              </div>
            ) : (
              <div className={`${styles.assistantBubble} ${styles.typing}`} role="status">
                <span className={styles.dot} />
                <span className={styles.dot} />
                <span className={styles.dot} />
                <span className={styles.typingLabel}>{pending === "start" ? "ИИ готовит сцену…" : "ИИ думает…"}</span>
              </div>
            )}
          </li>
        )}
      </ol>

      {messages.length === 0 && !pending && !error && (
        <p className={styles.empty}>Диалог пока пуст.</p>
      )}

      {error && (
        <div className={styles.error} role="alert">
          <AlertIcon className={styles.errorIcon} />
          <div className={styles.errorBody}>
            <p className={styles.errorTitle}>
              {error.action === "start" ? "Не удалось начать разговор" : "Сообщение не доставлено"}
            </p>
            <p className={styles.errorText}>{error.message}</p>
          </div>
          <button type="button" className={styles.retry} onClick={onRetry}>
            <RefreshIcon width={16} height={16} />
            Повторить
          </button>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
