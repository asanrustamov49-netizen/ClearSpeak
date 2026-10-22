"use client";

import { useEffect, useRef, useState } from "react";

import styles from "./HintsBar.module.css";
import { RefreshIcon } from "./icons";
import { ChatApiError, postHints } from "@/lib/api";
import type { ChatTurn, LevelId, ReplyHint, TopicId } from "@/lib/types";

interface Props {
  /** Id of the AI message the hints answer; hints reset when it changes. */
  messageId: string;
  /** Hints that came with the AI reply (no extra request needed). */
  preset: ReplyHint[];
  level: LevelId;
  topic: TopicId;
  history: ChatTurn[];
  onPick: (text: string) => void;
}

type HintState = { status: "closed" } | { status: "loading" } | { status: "ready"; hints: ReplyHint[] } | { status: "error"; message: string };

export function HintsBar(props: Props) {
  // Remount per AI message so stale hints are never shown for a new question.
  return <HintsBarInner key={props.messageId} {...props} />;
}

function HintsBarInner({ preset, level, topic, history, onPick }: Props) {
  const [state, setState] = useState<HintState>({ status: "closed" });
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const load = () => {
    if (preset.length >= 2) {
      setState({ status: "ready", hints: preset });
      return;
    }
    // Only when the reply carried no usable hints: ask the server separately.
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ status: "loading" });
    postHints({ level, topic, messages: history }, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setState({ status: "ready", hints: result.hints });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", message: error instanceof ChatApiError ? error.message : "Не удалось получить подсказки." });
      });
  };

  if (state.status === "closed") {
    return (
      <button type="button" className={styles.trigger} onClick={load}>
        <span aria-hidden="true">💡</span> Не знаю, что сказать
      </button>
    );
  }

  return (
    <div className={styles.panel} aria-live="polite">
      <div className={styles.head}>
        <span>
          <span aria-hidden="true">💡</span> Можно ответить так — выберите и при желании измените:
        </span>
        <button type="button" className={styles.close} onClick={() => setState({ status: "closed" })}>
          Скрыть
        </button>
      </div>
      {state.status === "loading" && <p className={styles.muted}>Подбираем варианты…</p>}
      {state.status === "error" && (
        <p className={styles.error}>
          {state.message}{" "}
          <button type="button" className={styles.retry} onClick={load}>
            <RefreshIcon width={14} height={14} /> Повторить
          </button>
        </p>
      )}
      {state.status === "ready" && (
        <ul className={styles.list}>
          {state.hints.map((hint) => (
            <li key={hint.text}>
              <button
                type="button"
                className={styles.hint}
                onClick={() => {
                  onPick(hint.text);
                  setState({ status: "closed" });
                }}
              >
                <span lang="en" className={styles.hintText}>
                  {hint.text}
                </span>
                <span className={styles.hintTranslation}>{hint.translation}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
