"use client";
import { useState } from "react";
import styles from "./ImageContextCard.module.css";
import type { SessionImage } from "@/hooks/useChatSession";

export function ImageContextCard({ image }: { image: SessionImage }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`${styles.card} ${expanded ? styles.expanded : ""}`}>
      <button
        type="button"
        className={styles.thumbButton}
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-label={expanded ? "Уменьшить изображение" : "Увеличить изображение"}
      >
        <img src={image.url} alt={`Обсуждаемое изображение: ${image.context.topic}`} className={styles.image} />
      </button>
      <div className={styles.meta}>
        <p className={styles.topic}>{image.context.topic}</p>
        <p className={styles.note}>ИИ знает изображение по описанию vision-модели, а не видит его напрямую.</p>
        <details className={styles.details}>
          <summary>Что «увидел» ИИ</summary>
          <p lang="en">{image.context.description}</p>
        </details>
      </div>
    </div>
  );
}
