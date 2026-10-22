"use client";

import { useCallback, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { HintsBar } from "./HintsBar";
import { MicIcon, SendIcon, StopIcon } from "./icons";
import styles from "./Composer.module.css";
import { VoiceModePanel } from "./VoiceModePanel";
import type { Playback } from "@/hooks/useSpeech";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import type { VoiceMode } from "@/hooks/useVoiceMode";
import { MAX_USER_MESSAGE_CHARS } from "@/lib/constants";
import type { ChatTurn, LevelId, ReplyHint, TopicId } from "@/lib/types";

export interface HintsSource {
  messageId: string;
  preset: ReplyHint[];
  level: LevelId;
  topic: TopicId;
  history: ChatTurn[];
}

interface Props {
  /** Input is locked (no opening line yet, or the opening failed). */
  disabled: boolean;
  /** A request is in flight; typing is allowed, sending is not. */
  busy: boolean;
  onSend: (text: string) => boolean;
  /** Present when the last message is the AI's and the learner may need help answering. */
  hints: HintsSource | null;
  voice: VoiceMode;
  playback: Playback | null;
  onStopPlayback: () => void;
}

const VOICE_UNAVAILABLE: Record<"unsupported" | "insecure", string> = {
  unsupported: "Голосовой ввод и режим «Только голос» не поддерживаются этим браузером — попробуйте Chrome или Edge. Текстовый режим работает.",
  insecure: "Микрофон и режим «Только голос» доступны только по HTTPS или на localhost. Текстовый режим работает.",
};

export function Composer({ disabled, busy, onSend, hints, voice, playback, onStopPlayback }: Props) {
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();

  const appendTranscript = useCallback((text: string) => {
    setDraft((current) => {
      const joined = current.trim() ? `${current.trimEnd()} ${text}` : text;
      return joined.slice(0, MAX_USER_MESSAGE_CHARS);
    });
  }, []);

  const dictation = useSpeechRecognition({ lang: "en-US", onFinalTranscript: appendTranscript });

  const trimmed = draft.trim();
  const tooLong = draft.length > MAX_USER_MESSAGE_CHARS;
  const canSend = !disabled && !busy && trimmed.length > 0 && !tooLong && !dictation.listening;

  const submit = () => {
    if (!canSend) return;
    if (onSend(trimmed)) {
      setDraft("");
      textareaRef.current?.focus();
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const toggleMic = () => {
    if (dictation.listening) dictation.stop();
    else dictation.start();
  };

  const micUnavailable = dictation.support === "unsupported" || dictation.support === "insecure";

  const toolbar = (
    <div className={styles.toolbar}>
      {hints && !voice.enabled && (
        <HintsBar
          {...hints}
          onPick={(text) => {
            setDraft(text.slice(0, MAX_USER_MESSAGE_CHARS));
            textareaRef.current?.focus();
          }}
        />
      )}
      {dictation.support === "supported" && (
        <label className={styles.voiceToggle}>
          <input
            type="checkbox"
            role="switch"
            className={styles.switch}
            checked={voice.enabled}
            disabled={disabled}
            onChange={(event) => {
              if (event.target.checked) {
                dictation.abort();
                voice.enable();
              } else {
                voice.disable();
              }
            }}
          />
          Только голос
        </label>
      )}
    </div>
  );

  if (voice.enabled) {
    return (
      <div className={styles.composer} aria-label="Голосовой режим">
        {toolbar}
        <VoiceModePanel voice={voice} busy={busy} disabled={disabled} playback={playback} onStopPlayback={onStopPlayback} />
      </div>
    );
  }

  return (
    <form className={styles.composer} onSubmit={handleSubmit} aria-label="Ваш ответ">
      {toolbar}
      {dictation.listening && (
        <div className={styles.listening} role="status">
          <span className={styles.pulse} aria-hidden="true" />
          <span>Слушаю… говорите по-английски</span>
          {dictation.interim && (
            <span className={styles.interim} lang="en">
              «{dictation.interim}»
            </span>
          )}
        </div>
      )}

      <div className={styles.field} data-disabled={disabled || undefined}>
        <label htmlFor="composer-input" className="visually-hidden">
          Сообщение на английском
        </label>
        <textarea
          id="composer-input"
          ref={textareaRef}
          className={styles.input}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? "Дождитесь первого сообщения ИИ…" : "Type your answer in English…"}
          rows={1}
          maxLength={MAX_USER_MESSAGE_CHARS + 200}
          disabled={disabled}
          aria-describedby={hintId}
          aria-invalid={tooLong || undefined}
          lang="en"
          spellCheck={false}
          autoComplete="off"
        />

        <div className={styles.actions}>
          {!micUnavailable && dictation.support !== "unknown" && (
            <button
              type="button"
              className={`${styles.iconButton} ${dictation.listening ? styles.micActive : ""}`}
              onClick={toggleMic}
              disabled={disabled}
              aria-pressed={dictation.listening}
              aria-label={dictation.listening ? "Остановить запись" : "Говорить в микрофон"}
              title={dictation.listening ? "Остановить запись" : "Говорить в микрофон"}
            >
              {dictation.listening ? <StopIcon /> : <MicIcon />}
            </button>
          )}
          <button
            type="submit"
            className={styles.send}
            disabled={!canSend}
            aria-label="Отправить сообщение"
            title="Отправить (Enter)"
          >
            <SendIcon />
          </button>
        </div>
      </div>

      <div id={hintId} className={styles.meta}>
        {dictation.error ? (
          <span className={styles.voiceError} role="alert">
            {dictation.error}
          </span>
        ) : micUnavailable ? (
          <span>{VOICE_UNAVAILABLE[dictation.support as "unsupported" | "insecure"]}</span>
        ) : (
          <span>Enter — отправить, Shift+Enter — новая строка. Распознанный текст можно поправить перед отправкой.</span>
        )}
        <span className={tooLong ? styles.counterOver : styles.counter} aria-live="polite">
          {draft.length > MAX_USER_MESSAGE_CHARS * 0.8 ? `${draft.length}/${MAX_USER_MESSAGE_CHARS}` : ""}
        </span>
      </div>
    </form>
  );
}
