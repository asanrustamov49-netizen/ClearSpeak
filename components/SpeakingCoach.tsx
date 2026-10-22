"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Composer, type HintsSource } from "./Composer";
import { CorrectionsPanel } from "./CorrectionsPanel";
import { DictionaryDialog, type DictionaryMode } from "./DictionaryDialog";
import { ImageContextCard } from "./ImageContextCard";
import { ImageStudio } from "./ImageStudio";
import { BookIcon, CheckIcon, FlagIcon, RefreshIcon, SparkIcon } from "./icons";
import { MessageList } from "./MessageList";
import { SetupPanel } from "./SetupPanel";
import styles from "./SpeakingCoach.module.css";
import { SummaryView } from "./SummaryView";
import { VoiceSettings } from "./VoiceSettings";
import type { PlaybackTools, WordTools } from "./wordTools";
import { useChatSession, type SessionImage } from "@/hooks/useChatSession";
import { progressActions, useProgress } from "@/hooks/useProgress";
import { useSpeech } from "@/hooks/useSpeech";
import { useVoiceMode, type VoiceMode } from "@/hooks/useVoiceMode";
import { fetchImageStatus } from "@/lib/api";
import { DEFAULT_SPEECH_RATE, getScenario, LEVELS, MAX_HISTORY_MESSAGES } from "@/lib/constants";
import { findWord } from "@/lib/progress";
import type { ImageStatus } from "@/lib/types";
import { normalizeWord } from "@/lib/vocabulary";

export function SpeakingCoach() {
  const progress = useProgress();
  const rate = progress?.data.speechRate ?? DEFAULT_SPEECH_RATE;
  const autoSpeak = progress?.data.autoSpeak ?? false;
  const speech = useSpeech(rate);
  const { play, stop: stopSpeaking } = speech;
  const audioAvailable = speech.provider === "cartesia" || speech.provider === "omniroute" || speech.browserSupported === true;

  const [dictionary, setDictionary] = useState<{ open: boolean; mode: DictionaryMode }>({ open: false, mode: "list" });
  const voiceRef = useRef<VoiceMode | null>(null);
  const [studioOpen, setStudioOpen] = useState(false);
  const [imageStatus, setImageStatus] = useState<ImageStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchImageStatus().then((status) => {
      if (!cancelled) setImageStatus(status);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleAssistantMessage = useCallback(
    (id: string, text: string) => {
      const voice = voiceRef.current;
      if (voice?.enabled) {
        // Voice mode: always read the reply, then re-open the mic once playback is over.
        if (!audioAvailable) {
          voice.resumeAfterReply();
          return;
        }
        voice.markSpeaking();
        play(id, text, { onDone: () => voice.resumeAfterReply() });
        return;
      }
      if (autoSpeak && audioAvailable) play(id, text);
    },
    [audioAvailable, autoSpeak, play],
  );

  const session = useChatSession({
    onAssistantMessage: handleAssistantMessage,
    onTurnAnswered: progressActions.recordPractice,
    onSummary: (summary, snapshot) => {
      progressActions.recordSession({
        id: snapshot.sessionId,
        finishedAt: new Date().toISOString(),
        level: snapshot.level,
        topic: snapshot.topic,
        turns: snapshot.messages.filter((message) => message.role === "user" && message.corrections).length,
        // Same count as the summary screen: session words plus words the summary found in the dialogue.
        newWords: new Set([...snapshot.vocabulary, ...summary.newWords].map((item) => normalizeWord(item.word))).size,
        goal: summary.goal.status,
      });
    },
    savedWords: progress?.data.words.map((word) => word.word),
  });
  const { state } = session;

  const voice = useVoiceMode({ send: session.send, stopPlayback: stopSpeaking });
  useEffect(() => {
    voiceRef.current = voice;
  }, [voice]);

  const level = LEVELS.find((item) => item.id === state.level);
  const scenario = getScenario(state.topic);
  const hasOpening = state.messages.some((message) => message.role === "assistant");
  const lastMessage = state.messages[state.messages.length - 1];

  const words: WordTools = {
    level: state.level,
    canSave: progress !== null,
    isSaved: (word) => (progress ? findWord(progress.data, word) !== undefined : false),
    lookup: (word) => {
      const key = normalizeWord(word);
      const fromSession = state.vocabulary.find((item) => normalizeWord(item.word) === key);
      if (fromSession) return { translation: fromSession.translation, note: fromSession.note };
      const saved = progress ? findWord(progress.data, word) : undefined;
      return saved ? { translation: saved.translation, note: saved.note } : null;
    },
    save: progressActions.saveWord,
  };

  const audio: PlaybackTools = {
    available: audioAvailable,
    playback: speech.playback,
    play,
    stop: stopSpeaking,
    engineLabel: speech.engineLabel,
  };

  const hints: HintsSource | null =
    lastMessage?.role === "assistant" && !state.pending
      ? {
          messageId: lastMessage.id,
          preset: lastMessage.hints ?? [],
          level: state.level,
          topic: state.topic,
          history: state.messages.slice(-MAX_HISTORY_MESSAGES).map(({ role, content }) => ({ role, content })),
        }
      : null;

  // The session owns the image object URL; release it when the session ends.
  const sessionImageUrl = state.image?.url ?? null;
  useEffect(() => {
    if (!sessionImageUrl) return;
    return () => URL.revokeObjectURL(sessionImageUrl);
  }, [sessionImageUrl]);

  const handleNewSession = () => {
    stopSpeaking();
    voice.disable();
    session.reset();
  };

  const handleStartWithImage = (image: SessionImage) => {
    setStudioOpen(false);
    session.start(image);
  };

  const handleFinish = () => {
    stopSpeaking();
    voice.disable();
    session.finish();
  };

  const canFinish = session.turns > 0 && state.pending === null;

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.logo} aria-hidden="true">
            <SparkIcon width={18} height={18} />
          </span>
          <span className={styles.brandName}>
            SpeakUp <span className={styles.brandAi}>AI</span>
          </span>
        </div>

        <div className={styles.headerRight}>
          {state.phase === "chat" && (
            <>
              <p className={styles.sessionChip}>
                <span className="visually-hidden">Сессия: </span>
                {level?.label} · {scenario.label}
              </p>
              <dl className={styles.stats}>
                <div className={styles.stat}>
                  <dt>Реплики</dt>
                  <dd>{session.turns}</dd>
                </div>
                <div className={styles.stat}>
                  <dt>Новые слова</dt>
                  <dd>{state.vocabulary.length}</dd>
                </div>
              </dl>
            </>
          )}
          <button
            type="button"
            className={styles.headerButton}
            onClick={() => setDictionary({ open: true, mode: "list" })}
            aria-label={`Мой словарь${progress ? `, слов: ${progress.data.words.length}` : ""}`}
          >
            <BookIcon width={16} height={16} />
            <span className={styles.buttonText}>Словарь</span>
            {progress && <span className={styles.badge}>{progress.data.words.length}</span>}
          </button>
          {state.phase === "chat" && (
            <button
              type="button"
              className={styles.headerButton}
              onClick={handleFinish}
              disabled={!canFinish}
              title={canFinish ? "Завершить и посмотреть итоги" : "Итоги будут доступны после вашей первой реплики"}
            >
              <FlagIcon width={16} height={16} />
              <span className={styles.buttonText}>Завершить</span>
            </button>
          )}
          {state.phase !== "setup" && (
            <button type="button" className={styles.headerButton} onClick={handleNewSession} aria-label="Новая сессия">
              <RefreshIcon width={16} height={16} />
              <span className={styles.buttonText}>Новая сессия</span>
            </button>
          )}
        </div>
      </header>

      <main className={styles.main}>
        {state.phase === "setup" && (
          <SetupPanel
            level={state.level}
            topic={state.topic}
            onLevelChange={session.setLevel}
            onTopicChange={session.setTopic}
            onStart={() => session.start()}
            onGenerateImage={() => setStudioOpen(true)}
            imageStatus={imageStatus}
            progress={progress}
            onReview={() => setDictionary({ open: true, mode: "review" })}
            onOpenDictionary={() => setDictionary({ open: true, mode: "list" })}
          />
        )}

        {state.phase === "summary" && (
          <SummaryView
            summary={state.summary}
            topic={state.topic}
            turns={session.turns}
            sessionWords={state.vocabulary}
            words={words}
            onRetry={session.retrySummary}
            onBack={session.backToChat}
            onNewSession={handleNewSession}
          />
        )}

        {state.phase === "chat" && (
          <div className={styles.workspace}>
            <section className={styles.chat} aria-label="Разговор">
              {state.image && <ImageContextCard image={state.image} />}
              {scenario.goal && (
                <div className={`${styles.goal} ${state.goalAchieved ? styles.goalDone : ""}`}>
                  <span className={styles.goalText}>
                    <span aria-hidden="true">🎯</span> {scenario.goal}
                  </span>
                  {state.goalAchieved && (
                    <span className={styles.goalStatus} role="status">
                      <CheckIcon width={14} height={14} /> Похоже, цель достигнута —{" "}
                      <button type="button" className={styles.goalLink} onClick={handleFinish} disabled={!canFinish}>
                        посмотреть итоги
                      </button>
                    </span>
                  )}
                </div>
              )}
              <MessageList
                messages={state.messages}
                pending={state.pending}
                streamingText={state.streamingText}
                error={state.error}
                onRetry={session.retry}
                topic={state.topic}
                words={words}
                audio={audio}
              />
              <Composer
                disabled={!hasOpening}
                busy={state.pending !== null}
                onSend={session.send}
                hints={hints}
                voice={voice}
                playback={speech.playback}
                onStopPlayback={stopSpeaking}
              />
            </section>

            <aside className={styles.aside} aria-label="Исправления и настройки">
              <CorrectionsPanel messages={state.messages} vocabulary={state.vocabulary} topic={state.topic} words={words} audio={audio} />
              <VoiceSettings
                speech={speech}
                rate={rate}
                onRateChange={progressActions.setSpeechRate}
                autoSpeak={autoSpeak}
                onAutoSpeakChange={progressActions.setAutoSpeak}
              />
            </aside>
          </div>
        )}
      </main>

      <ImageStudio
        open={studioOpen}
        onClose={() => setStudioOpen(false)}
        level={state.level}
        status={imageStatus}
        onStart={handleStartWithImage}
      />

      <DictionaryDialog
        open={dictionary.open}
        mode={dictionary.mode}
        onModeChange={(mode) => setDictionary((current) => ({ ...current, mode }))}
        onClose={() => setDictionary((current) => ({ ...current, open: false }))}
        progress={progress}
        audio={audio}
      />
    </div>
  );
}
