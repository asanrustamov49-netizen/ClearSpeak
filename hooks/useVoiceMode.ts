"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useSpeechRecognition, type SpeechRecognitionControls } from "./useSpeechRecognition";

/** Pause after the learner stops speaking before the message is sent automatically. */
export const VOICE_SEND_DELAY_MS = 1500;
/** Gap between the end of AI playback and re-opening the microphone. */
const RESUME_DELAY_MS = 400;

export type VoicePhase =
  /** Waiting for the learner to tap the mic. */
  | "idle"
  | "listening"
  /** Speech recognised, short pause before auto-send. */
  | "countdown"
  /** Message sent, waiting for the AI. */
  | "waiting"
  /** AI reply is being played. */
  | "speaking";

export interface VoiceMode {
  enabled: boolean;
  phase: VoicePhase;
  transcript: string;
  recognition: SpeechRecognitionControls;
  enable: () => void;
  disable: () => void;
  /** Starts listening (stops any playback first via the callback). */
  listen: () => void;
  stopListening: () => void;
  cancelSend: () => void;
  sendNow: () => void;
  /** Call when an AI reply starts playing in voice mode. */
  markSpeaking: () => void;
  /** Call when that playback ended or failed: re-opens the microphone once. */
  resumeAfterReply: () => void;
}

interface Options {
  send: (text: string) => boolean;
  /** Stops any AI audio so the microphone never records it. */
  stopPlayback: () => void;
}

export function useVoiceMode({ send, stopPlayback }: Options): VoiceMode {
  const [enabled, setEnabled] = useState(false);
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [transcript, setTranscript] = useState("");
  const enabledRef = useRef(false);
  const transcriptRef = useRef("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendRef = useRef(send);

  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  useEffect(() => () => clearTimer(), []);

  const setText = (text: string) => {
    transcriptRef.current = text;
    setTranscript(text);
  };

  const sendNow = useCallback(() => {
    clearTimer();
    const text = transcriptRef.current.trim();
    if (!enabledRef.current || !text) {
      setPhase("idle");
      return;
    }
    if (sendRef.current(text)) {
      setText("");
      setPhase("waiting");
    } else {
      // Another request is in flight; keep the text and let the learner retry.
      setPhase("idle");
    }
  }, []);

  const recognition = useSpeechRecognition({
    lang: "en-US",
    onFinalTranscript: (text) => {
      setText(transcriptRef.current ? `${transcriptRef.current} ${text}` : text);
    },
    onEnd: ({ error }) => {
      if (!enabledRef.current) return;
      if (transcriptRef.current.trim() && !error) {
        setPhase("countdown");
        clearTimer();
        timerRef.current = setTimeout(sendNow, VOICE_SEND_DELAY_MS);
      } else {
        // Nothing heard or an error: stop here instead of re-listening in a loop.
        setPhase("idle");
      }
    },
  });

  const { start: startRecognition, abort: abortRecognition, stop: stopRecognition } = recognition;

  const listen = useCallback(() => {
    if (!enabledRef.current) return;
    clearTimer();
    stopPlayback();
    setPhase("listening");
    startRecognition();
  }, [startRecognition, stopPlayback]);

  const enable = useCallback(() => {
    enabledRef.current = true;
    setEnabled(true);
    setText("");
    setPhase("idle");
  }, []);

  const disable = useCallback(() => {
    enabledRef.current = false;
    clearTimer();
    abortRecognition();
    setEnabled(false);
    setPhase("idle");
  }, [abortRecognition]);

  const stopListening = useCallback(() => stopRecognition(), [stopRecognition]);

  const cancelSend = useCallback(() => {
    clearTimer();
    setText("");
    setPhase("idle");
  }, []);

  const markSpeaking = useCallback(() => {
    if (enabledRef.current) setPhase("speaking");
  }, []);

  const resumeAfterReply = useCallback(() => {
    if (!enabledRef.current) return;
    setPhase("idle");
    clearTimer();
    timerRef.current = setTimeout(() => {
      if (enabledRef.current) {
        setPhase("listening");
        startRecognition();
      }
    }, RESUME_DELAY_MS);
  }, [startRecognition]);

  return {
    enabled,
    phase,
    transcript,
    recognition,
    enable,
    disable,
    listen,
    stopListening,
    cancelSend,
    sendNow,
    markSpeaking,
    resumeAfterReply,
  };
}
