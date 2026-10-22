"use client";

import { useState } from "react";

import { MicIcon, SpeakerIcon, StopIcon } from "./icons";
import styles from "./PracticePhrase.module.css";
import type { PlaybackTools } from "./wordTools";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { comparePhrase, type PhraseComparison } from "@/lib/phraseMatch";

interface Props {
  id: string;
  target: string;
  audio: PlaybackTools;
}

const VERDICT_TEXT: Record<PhraseComparison["verdict"], string> = {
  match: "Совпадает! Распознанный текст соответствует фразе.",
  close: "Почти. Распознано с небольшими отличиями — попробуйте ещё раз.",
  different: "Распознано другое. Прослушайте фразу и попробуйте снова.",
};

/** "Repeat after me": compares speech-recognition TEXT with the corrected phrase (not phonetics). */
export function PracticePhrase({ id, target, audio }: Props) {
  const [heard, setHeard] = useState<string | null>(null);
  const [result, setResult] = useState<PhraseComparison | null>(null);

  const recognition = useSpeechRecognition({
    lang: "en-US",
    onFinalTranscript: (text) => {
      setHeard(text);
      setResult(comparePhrase(target, text));
    },
  });

  const playId = `practice:${id}`;
  const playing = audio.playback?.id === playId;
  const micReady = recognition.support === "supported";

  return (
    <div className={styles.practice}>
      <div className={styles.buttons}>
        {audio.available && (
          <button
            type="button"
            className={styles.button}
            aria-pressed={playing}
            onClick={() => (playing ? audio.stop() : audio.play(playId, target))}
          >
            {playing ? <StopIcon width={14} height={14} /> : <SpeakerIcon width={14} height={14} />}
            {playing ? "Стоп" : "Прослушать"}
          </button>
        )}
        {micReady && (
          <button
            type="button"
            className={`${styles.button} ${recognition.listening ? styles.recording : ""}`}
            aria-pressed={recognition.listening}
            onClick={() => {
              if (recognition.listening) {
                recognition.stop();
                return;
              }
              audio.stop();
              setHeard(null);
              setResult(null);
              recognition.start();
            }}
          >
            {recognition.listening ? <StopIcon width={14} height={14} /> : <MicIcon width={14} height={14} />}
            {recognition.listening ? "Слушаю…" : result ? "Ещё раз" : "Повторить за мной"}
          </button>
        )}
      </div>

      {recognition.support === "unsupported" && (
        <p className={styles.note}>Практика произношения недоступна: браузер не поддерживает распознавание речи.</p>
      )}
      {recognition.support === "insecure" && (
        <p className={styles.note}>Практика произношения требует HTTPS или localhost.</p>
      )}
      {recognition.error && (
        <p className={styles.warn} role="alert">
          {recognition.error}
        </p>
      )}

      {result && heard !== null && (
        <div className={`${styles.result} ${styles[result.verdict]}`} role="status">
          <p className={styles.verdict}>{VERDICT_TEXT[result.verdict]}</p>
          <p className={styles.heard}>
            Распознано: <span lang="en">«{heard}»</span>
          </p>
          {result.verdict !== "match" && result.missing.length > 0 && (
            <p className={styles.heard}>
              Не распознаны слова: <span lang="en">{result.missing.join(", ")}</span>
            </p>
          )}
          <p className={styles.disclaimer}>Сравнивается текст распознавания речи браузером, а не фонетика произношения.</p>
        </div>
      )}
    </div>
  );
}
