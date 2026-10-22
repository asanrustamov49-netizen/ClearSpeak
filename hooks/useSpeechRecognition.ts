"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

export type RecognitionSupport =
  /** Not known yet (server render / before hydration). */
  | "unknown"
  | "supported"
  /** Browser has no SpeechRecognition implementation. */
  | "unsupported"
  /** API exists but the page is not a secure context, so the microphone is blocked. */
  | "insecure";

function getRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

function readSupport(): RecognitionSupport {
  if (!getRecognitionConstructor()) return "unsupported";
  if (!window.isSecureContext) return "insecure";
  return "supported";
}

const noopSubscribe = () => () => undefined;

export function useRecognitionSupport(): RecognitionSupport {
  return useSyncExternalStore<RecognitionSupport>(noopSubscribe, readSupport, () => "unknown");
}

const ERROR_MESSAGES: Record<SpeechRecognitionErrorCode, string | null> = {
  aborted: null,
  "no-speech": "Речь не распознана. Попробуйте ещё раз и говорите чуть громче.",
  "audio-capture": "Микрофон не найден. Подключите устройство или используйте текстовый ввод.",
  "not-allowed": "Доступ к микрофону запрещён. Разрешите его в настройках сайта в браузере.",
  "service-not-allowed": "Браузер не разрешает распознавание речи на этой странице.",
  network: "Сервис распознавания речи недоступен (нужен интернет). Используйте текстовый ввод.",
  "language-not-supported": "Браузер не поддерживает распознавание английской речи.",
  "bad-grammar": "Ошибка распознавания речи. Попробуйте ещё раз.",
};

/** Only one recognition session can use the microphone at a time across the whole page. */
let activeRecognition: SpeechRecognition | null = null;

interface Options {
  lang?: string;
  /** Called with the final transcript of one utterance. */
  onFinalTranscript: (text: string) => void;
  /** Called when the recognition session ends (after silence, stop() or an error). */
  onEnd?: (info: { heardSpeech: boolean; error: SpeechRecognitionErrorCode | null }) => void;
}

export interface SpeechRecognitionControls {
  support: RecognitionSupport;
  listening: boolean;
  /** Not-yet-final text while the user speaks. */
  interim: string;
  error: string | null;
  start: () => void;
  stop: () => void;
  /** Stops immediately and discards pending results. */
  abort: () => void;
  clearError: () => void;
}

export function useSpeechRecognition({ lang = "en-US", onFinalTranscript, onEnd }: Options): SpeechRecognitionControls {
  const support = useRecognitionSupport();
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const onFinalRef = useRef(onFinalTranscript);
  const onEndRef = useRef(onEnd);

  useEffect(() => {
    onFinalRef.current = onFinalTranscript;
    onEndRef.current = onEnd;
  }, [onFinalTranscript, onEnd]);

  useEffect(
    () => () => {
      const recognition = recognitionRef.current;
      if (!recognition) return;
      recognition.onstart = recognition.onend = recognition.onresult = recognition.onerror = null;
      recognition.abort();
      if (activeRecognition === recognition) activeRecognition = null;
      recognitionRef.current = null;
    },
    [],
  );

  const start = useCallback(() => {
    const Ctor = getRecognitionConstructor();
    if (!Ctor || !window.isSecureContext || recognitionRef.current) return;

    // Release the microphone from any other component first.
    activeRecognition?.abort();

    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    let heardSpeech = false;
    let lastError: SpeechRecognitionErrorCode | null = null;

    recognition.onstart = () => setListening(true);
    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) finalText += transcript;
        else interimText += transcript;
      }
      setInterim(interimText);
      if (finalText.trim()) {
        heardSpeech = true;
        onFinalRef.current(finalText.trim());
      }
    };
    recognition.onerror = (event) => {
      lastError = event.error;
      const message = ERROR_MESSAGES[event.error] ?? "Ошибка распознавания речи. Попробуйте ещё раз.";
      if (message) setError(message);
    };
    recognition.onend = () => {
      setListening(false);
      setInterim("");
      if (activeRecognition === recognition) activeRecognition = null;
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      onEndRef.current?.({ heardSpeech, error: lastError });
    };

    recognitionRef.current = recognition;
    activeRecognition = recognition;
    setError(null);
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      if (activeRecognition === recognition) activeRecognition = null;
      setError("Не удалось включить микрофон. Попробуйте ещё раз.");
    }
  }, [lang]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const abort = useCallback(() => {
    recognitionRef.current?.abort();
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { support, listening, interim, error, start, stop, abort, clearError };
}
