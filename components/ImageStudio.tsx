"use client";
import { useEffect, useRef, useState } from "react";
import { AlertIcon, ArrowRightIcon, CloseIcon, ImageIcon, RefreshIcon } from "./icons";
import styles from "./ImageStudio.module.css";
import type { SessionImage } from "@/hooks/useChatSession";
import { ChatApiError, postDescribeImage, postGenerateImage } from "@/lib/api";
import { LEVELS, MAX_IMAGE_TOPIC_CHARS } from "@/lib/constants";
import type { ImageStatus, LevelId } from "@/lib/types";

const PRESETS = [
  "A cozy café in London on a rainy morning",
  "A busy airport departure hall",
  "A family picnic in a sunny park",
  "A modern office meeting room",
  "A street food market at night",
  "A beach at sunset with surfers",
];

interface Props {
  open: boolean;
  onClose: () => void;
  level: LevelId;
  status: ImageStatus | null;
  onStart: (image: SessionImage) => void;
}

type Phase =
  | { kind: "idle" }
  | { kind: "generating"; startedAt: number }
  | { kind: "ready" }
  | { kind: "describing" }
  | { kind: "error"; message: string; during: "generate" | "describe" };

export function ImageStudio({ open, onClose, level, status, onStart }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const [topic, setTopic] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [image, setImage] = useState<{ url: string; blob: Blob; topic: string } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const imageRef = useRef(image);
  const handedOverRef = useRef(false);

  useEffect(() => {
    imageRef.current = image;
  }, [image]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (phase.kind !== "generating") return;
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - phase.startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
      if (imageRef.current && !handedOverRef.current) URL.revokeObjectURL(imageRef.current.url);
    },
    [],
  );

  const replaceImage = (next: { url: string; blob: Blob; topic: string } | null) => {
    if (image && !handedOverRef.current) URL.revokeObjectURL(image.url);
    handedOverRef.current = false;
    setImage(next);
  };

  const generate = (value = topic) => {
    const clean = value.replace(/\s+/g, " ").trim();
    if (clean.length < 3) {
      setPhase({ kind: "error", message: "Опишите тему хотя бы в нескольких словах.", during: "generate" });
      return;
    }
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setTopic(clean);
    setElapsed(0);
    setPhase({ kind: "generating", startedAt: Date.now() });
    postGenerateImage(clean, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        replaceImage({ url: URL.createObjectURL(blob), blob, topic: clean });
        setPhase({ kind: "ready" });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setPhase({
          kind: "error",
          during: "generate",
          message: error instanceof ChatApiError ? error.message : "Не удалось сгенерировать изображение.",
        });
      });
  };

  const startConversation = () => {
    if (!image) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setPhase({ kind: "describing" });
    postDescribeImage(image.topic, image.blob, controller.signal)
      .then((context) => {
        if (controller.signal.aborted) return;
        handedOverRef.current = true;
        onStart({ url: image.url, context });
        setImage(null);
        setPhase({ kind: "idle" });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setPhase({
          kind: "error",
          during: "describe",
          message: error instanceof ChatApiError ? error.message : "Не удалось проанализировать изображение.",
        });
      });
  };

  const cancel = () => {
    controllerRef.current?.abort();
    setPhase(image ? { kind: "ready" } : { kind: "idle" });
  };

  const busy = phase.kind === "generating" || phase.kind === "describing";
  const levelLabel = LEVELS.find((item) => item.id === level)?.label ?? level;
  const unavailable = status !== null && !status.generation;

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="studio-title"
      onClose={() => {
        controllerRef.current?.abort();
        if (busy) setPhase(image ? { kind: "ready" } : { kind: "idle" });
        onClose();
      }}
    >
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>
            <ImageIcon width={14} height={14} /> Image Talk · {levelLabel}
          </p>
          <h2 id="studio-title" className={styles.title}>
            Generate Image
          </h2>
        </div>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Закрыть">
          <CloseIcon />
        </button>
      </header>

      <div className={styles.body}>
        {unavailable ? (
          <p className={styles.notice}>
            Генерация изображений не настроена на сервере (OMNIROUTE_IMAGE_MODEL). Остальные функции SpeakUp AI работают.
          </p>
        ) : (
          <>
            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault();
                generate();
              }}
            >
              <label htmlFor="image-topic" className={styles.label}>
                Что изобразить?
              </label>
              <div className={styles.inputRow}>
                <input
                  id="image-topic"
                  className={styles.input}
                  value={topic}
                  onChange={(event) => setTopic(event.target.value)}
                  maxLength={MAX_IMAGE_TOPIC_CHARS}
                  placeholder="Например: a cozy café in London"
                  disabled={busy}
                  autoComplete="off"
                />
                <button type="submit" className={styles.primary} disabled={busy || topic.trim().length < 3}>
                  {image ? "Сгенерировать" : "Generate"}
                </button>
              </div>
              <div className={styles.presets} role="group" aria-label="Готовые темы">
                {PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={styles.preset}
                    disabled={busy}
                    onClick={() => {
                      setTopic(preset);
                      generate(preset);
                    }}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </form>

            <div className={styles.stage} aria-live="polite" aria-busy={busy}>
              {phase.kind === "generating" && (
                <div className={styles.loading} role="status">
                  <span className={styles.shimmer} aria-hidden="true" />
                  <p className={styles.loadingTitle}>Рисуем «{topic}»…</p>
                  <p className={styles.loadingHint}>
                    {elapsed} с · обычно 15–45 секунд
                  </p>
                  <button type="button" className={styles.ghost} onClick={cancel}>
                    Отменить
                  </button>
                </div>
              )}

              {phase.kind !== "generating" && image && (
                <figure className={styles.figure}>
                  <img src={image.url} alt={`Сгенерированное изображение: ${image.topic}`} className={styles.image} />
                  <figcaption className={styles.caption}>{image.topic}</figcaption>
                </figure>
              )}

              {phase.kind === "idle" && !image && (
                <div className={styles.empty}>
                  <ImageIcon width={28} height={28} />
                  <p>Выберите тему или опишите свою. ИИ задаст вопросы об изображении на уровне {levelLabel}.</p>
                </div>
              )}

              {phase.kind === "error" && (
                <div className={styles.error} role="alert">
                  <AlertIcon />
                  <p>{phase.message}</p>
                  <button
                    type="button"
                    className={styles.ghost}
                    onClick={() => (phase.during === "describe" ? startConversation() : generate())}
                  >
                    <RefreshIcon width={14} height={14} /> Повторить
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {image && phase.kind !== "generating" && !unavailable && (
        <footer className={styles.footer}>
          <button type="button" className={styles.secondary} onClick={() => generate(image.topic)} disabled={busy}>
            <RefreshIcon width={16} height={16} /> Ещё вариант
          </button>
          {status?.vision === false ? (
            <p className={styles.notice}>Для разговора нужен анализ изображения: задайте OMNIROUTE_VISION_MODEL.</p>
          ) : (
            <button type="button" className={styles.cta} onClick={startConversation} disabled={busy}>
              {phase.kind === "describing" ? "Изучаем изображение…" : "Start Conversation About This Image"}
              {phase.kind !== "describing" && <ArrowRightIcon width={18} height={18} />}
            </button>
          )}
        </footer>
      )}
    </dialog>
  );
}
