"use client";

import { StopIcon } from "./icons";
import styles from "./VoiceSettings.module.css";
import type { SpeechControls } from "@/hooks/useSpeech";
import { MAX_SPEECH_RATE, MIN_SPEECH_RATE } from "@/lib/constants";

interface Props {
  speech: SpeechControls;
  rate: number;
  onRateChange: (rate: number) => void;
  autoSpeak: boolean;
  onAutoSpeakChange: (value: boolean) => void;
}

export function VoiceSettings({ speech, rate, onRateChange, autoSpeak, onAutoSpeakChange }: Props) {
  if (speech.provider === null || speech.browserSupported === null) {
    return <p className={styles.note}>Проверяем доступность озвучивания…</p>;
  }

  const usesServer = speech.provider === "cartesia" || speech.provider === "omniroute";
  const canSpeak = usesServer || speech.browserSupported;

  return (
    <section className={styles.box} aria-labelledby="voice-title">
      <h2 id="voice-title" className={styles.title}>
        Озвучивание
      </h2>

      <p className={styles.provider}>
        <span className={usesServer ? styles.badgeCartesia : styles.badgeBrowser}>
          {usesServer ? speech.providerLabel : "Голос браузера"}
        </span>
        {usesServer
          ? "Аудио генерирует внешний сервис через наш сервер. Если он недоступен, фраза будет прочитана голосом браузера с пометкой."
          : speech.browserSupported
            ? "Серверное озвучивание не настроено — используется синтез речи браузера."
            : "Озвучивание недоступно: серверный TTS не настроен, а браузер не поддерживает синтез речи."}
      </p>

      {canSpeak && (
        <>
          <label className={styles.switchRow}>
            <span>Читать ответы вслух</span>
            <input
              type="checkbox"
              role="switch"
              className={styles.switch}
              checked={autoSpeak}
              onChange={(event) => onAutoSpeakChange(event.target.checked)}
            />
          </label>

          <label className={styles.rateRow}>
            <span className={styles.rateHead}>
              <span>Скорость речи</span>
              <output className={styles.rateValue}>{rate.toFixed(2)}×</output>
            </span>
            <input
              type="range"
              className={styles.range}
              min={MIN_SPEECH_RATE}
              max={MAX_SPEECH_RATE}
              step={0.05}
              value={rate}
              onChange={(event) => onRateChange(Number(event.target.value))}
              aria-valuetext={`${rate.toFixed(2)}×`}
            />
            <span className={styles.rateScale} aria-hidden="true">
              <span>{MIN_SPEECH_RATE}×</span>
              <span>1×</span>
              <span>{MAX_SPEECH_RATE}×</span>
            </span>
          </label>
          <p className={styles.note}>Кнопка 🐢 у ответа проигрывает его на 0.70× и не меняет эту настройку.</p>
        </>
      )}

      {!usesServer && speech.browserSupported && (
        speech.voices.length > 0 ? (
          <label className={styles.selectRow}>
            <span className={styles.selectLabel}>Голос браузера</span>
            <select className={styles.select} value={speech.voiceUri} onChange={(event) => speech.setVoiceUri(event.target.value)}>
              {speech.voices.map((voice) => (
                <option key={voice.uri} value={voice.uri}>
                  {voice.name} ({voice.lang})
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className={styles.note}>
            В системе нет английских голосов, поэтому ответы прочитает голос по умолчанию и произношение может быть неточным.
            Добавьте английский голос в настройках ОС или настройте серверный TTS (OMNIROUTE_TTS_MODEL или CARTESIA_API_KEY).
          </p>
        )
      )}

      {speech.playback && (
        <button type="button" className={styles.stop} onClick={speech.stop}>
          <StopIcon width={16} height={16} />
          {speech.playback.status === "loading" ? "Отменить загрузку" : "Остановить озвучивание"}
        </button>
      )}

      {speech.notice && <p className={styles.warn}>{speech.notice}</p>}
      {speech.error && (
        <p className={styles.error} role="alert">
          {speech.error}
        </p>
      )}
    </section>
  );
}
