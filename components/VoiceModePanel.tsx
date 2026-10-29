"use client";
import { MicIcon, StopIcon } from "./icons";
import styles from "./VoiceModePanel.module.css";
import type { Playback } from "@/hooks/useSpeech";
import type { VoiceMode } from "@/hooks/useVoiceMode";
import { VOICE_SEND_DELAY_MS } from "@/hooks/useVoiceMode";

interface Props {
  voice: VoiceMode;
  busy: boolean;
  disabled: boolean;
  playback: Playback | null;
  onStopPlayback: () => void;
}

const LABELS = {
  idle: "Нажмите на микрофон и говорите",
  listening: "Слушаю…",
  countdown: "Отправляю через секунду…",
  waiting: "ИИ думает…",
  speaking: "ИИ отвечает…",
} as const;

export function VoiceModePanel({ voice, busy, disabled, playback, onStopPlayback }: Props) {
  let phase = voice.phase;
  if (phase === "waiting" && !busy) phase = "idle";
  if (phase === "speaking" && !playback) phase = "idle";
  if (phase === "idle" && busy) phase = "waiting";
  if (phase === "idle" && playback) phase = "speaking";

  const listening = voice.recognition.listening;
  const canListen = !disabled && !busy && (phase === "idle" || phase === "speaking");

  return (
    <div className={styles.panel} data-phase={phase}>
      <div className={styles.row}>
        <button
          type="button"
          className={`${styles.mic} ${listening ? styles.micOn : ""}`}
          onClick={() => (listening ? voice.stopListening() : voice.listen())}
          disabled={!listening && !canListen}
          aria-label={listening ? "Закончить фразу" : "Говорить"}
          aria-pressed={listening}
        >
          {listening ? <StopIcon width={26} height={26} /> : <MicIcon width={26} height={26} />}
          {listening && <span className={styles.ring} aria-hidden="true" />}
        </button>

        <div className={styles.status} role="status" aria-live="polite">
          <p className={styles.label}>
            <span className={styles.dot} aria-hidden="true" />
            {disabled ? "Дождитесь первого сообщения ИИ…" : LABELS[phase]}
          </p>
          {(voice.transcript || voice.recognition.interim) && (
            <p className={styles.transcript} lang="en">
              {voice.transcript} <span className={styles.interim}>{voice.recognition.interim}</span>
            </p>
          )}
          {phase === "countdown" && (
            <span className={styles.progress} style={{ animationDuration: `${VOICE_SEND_DELAY_MS}ms` }} aria-hidden="true" />
          )}
        </div>
      </div>

      <div className={styles.actions}>
        {phase === "countdown" && (
          <>
            <button type="button" className={styles.action} onClick={voice.sendNow}>
              Отправить сейчас
            </button>
            <button type="button" className={styles.action} onClick={voice.cancelSend}>
              Отменить
            </button>
          </>
        )}
        {playback && (
          <button type="button" className={styles.action} onClick={onStopPlayback}>
            <StopIcon width={14} height={14} /> Прервать озвучивание
          </button>
        )}
        <button type="button" className={styles.action} onClick={voice.disable}>
          Вернуться к тексту
        </button>
      </div>

      {voice.recognition.error && (
        <p className={styles.error} role="alert">
          {voice.recognition.error}
        </p>
      )}
    </div>
  );
}
