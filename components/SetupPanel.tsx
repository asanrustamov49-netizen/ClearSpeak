"use client";

import { ArrowRightIcon, CheckIcon, ImageIcon } from "./icons";
import { ProgressCards } from "./ProgressCards";
import styles from "./SetupPanel.module.css";
import type { ProgressState } from "@/hooks/useProgress";
import { getScenario, LEVELS, VISIBLE_SCENARIOS } from "@/lib/constants";
import type { ImageStatus, LevelId, TopicId } from "@/lib/types";

interface Props {
  level: LevelId;
  topic: TopicId;
  onLevelChange: (level: LevelId) => void;
  onTopicChange: (topic: TopicId) => void;
  onStart: () => void;
  onGenerateImage: () => void;
  imageStatus: ImageStatus | null;
  progress: ProgressState | null;
  onReview: () => void;
  onOpenDictionary: () => void;
}

const CEFR: Record<LevelId, string> = { beginner: "A1–A2", intermediate: "B1–B2", advanced: "C1+" };

const FEATURES = ["Исправления с объяснениями на русском", "Новые слова над каждым ответом", "Голос, озвучивание и итоги"];

export function SetupPanel({
  level,
  topic,
  onLevelChange,
  onTopicChange,
  onStart,
  onGenerateImage,
  imageStatus,
  progress,
  onReview,
  onOpenDictionary,
}: Props) {
  const selectedLevel = LEVELS.find((item) => item.id === level);
  const selectedScenario = getScenario(topic);
  const imageUnavailable = imageStatus !== null && !imageStatus.generation;

  return (
    <section className={styles.setup} aria-labelledby="setup-title">
      <div className={styles.intro}>
        <p className={styles.badge}>
          <span className={styles.badgeDot} aria-hidden="true" />
          AI speaking coach · live role-play
        </p>
        <h1 id="setup-title" className={styles.title}>
          Говорите по-английски <span className={styles.accent}>свободнее</span>
        </h1>
        <p className={styles.lead}>
          Решайте реальные задачи на английском в ролевых сценариях: ИИ играет свою роль, а после каждой реплики
          подсказывает, как сказать точнее.
        </p>
        <ul className={styles.features}>
          {FEATURES.map((feature) => (
            <li key={feature}>
              <CheckIcon width={16} height={16} />
              {feature}
            </li>
          ))}
        </ul>
        <ProgressCards progress={progress} onReview={onReview} onOpenDictionary={onOpenDictionary} />
      </div>

      <form
        className={styles.builder}
        aria-label="Новая сессия"
        onSubmit={(event) => {
          event.preventDefault();
          onStart();
        }}
      >
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>
            <span className={styles.step}>1</span> Уровень
          </legend>
          <div className={styles.levels}>
            {LEVELS.map((option) => (
              <label key={option.id} className={styles.level}>
                <input
                  type="radio"
                  name="level"
                  value={option.id}
                  checked={level === option.id}
                  onChange={() => onLevelChange(option.id)}
                  className={styles.radio}
                />
                <span className={styles.levelBody}>
                  <span className={styles.levelLabel}>{option.label}</span>
                  <span className={styles.levelCefr}>{CEFR[option.id]}</span>
                </span>
              </label>
            ))}
          </div>
          <p className={styles.levelHint}>{selectedLevel?.hint}</p>
        </fieldset>

        <div className={styles.fieldset}>
          <div className={styles.sectionHead}>
            <span id="scenario-label" className={styles.legend}>
              <span className={styles.step}>2</span> Сценарий
            </span>
            <button
            type="button"
            className={styles.imagePill}
            onClick={onGenerateImage}
            title={imageUnavailable ? "Генерация изображений сейчас не настроена" : "Сгенерируйте картинку и обсудите её на английском"}
          >
              <ImageIcon width={16} height={16} />
              Generate Image
            </button>
          </div>
          <div className={styles.scenarios} role="radiogroup" aria-labelledby="scenario-label">
            {VISIBLE_SCENARIOS.map((option) => (
              <label key={option.id} className={styles.scenario}>
                <input
                  type="radio"
                  name="topic"
                  value={option.id}
                  checked={topic === option.id}
                  onChange={() => onTopicChange(option.id)}
                  className={styles.radio}
                />
                <span className={styles.scenarioBody}>
                  <span className={styles.scenarioIcon} aria-hidden="true">
                    {option.emoji}
                  </span>
                  <span className={styles.scenarioText}>
                    <span className={styles.scenarioLabel}>{option.label}</span>
                    <span className={styles.scenarioGoal}>{option.goal ?? "Свободный разговор без обязательной цели."}</span>
                  </span>
                  <span className={styles.scenarioCheck} aria-hidden="true">
                    <CheckIcon width={14} height={14} />
                  </span>
                </span>
              </label>
            ))}
          </div>

        </div>

        <p className={styles.imageNote}>
          <ImageIcon width={14} height={14} />
          {imageUnavailable
            ? "Генерация изображений сейчас не настроена — сценарии работают как обычно."
            : "Или нажмите Generate Image: ИИ создаст картинку и задаст вопросы о ней на вашем уровне."}
        </p>

        <div className={styles.footer}>
          <p className={styles.summary}>
            <span className={styles.summaryLabel}>Ваша сессия</span>
            {selectedLevel?.label} · {selectedScenario.emoji} {selectedScenario.label}
          </p>
          <button type="submit" className={styles.start}>
            Start Speaking
            <ArrowRightIcon />
          </button>
        </div>
      </form>
    </section>
  );
}
