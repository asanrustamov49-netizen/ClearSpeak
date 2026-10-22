"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { ChatApiError, fetchTtsAudio, fetchTtsStatus } from "@/lib/api";
import { MAX_TTS_CHARS } from "@/lib/constants";
import type { TtsProvider } from "@/lib/types";

export interface VoiceOption {
  uri: string;
  name: string;
  lang: string;
}

// ---- Browser voices (speechSynthesis) as an external store ----

const EMPTY_VOICES: VoiceOption[] = [];
let cachedVoices: VoiceOption[] = EMPTY_VOICES;
let cachedKey = "";

function hasSynthesis(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

function readVoices(): VoiceOption[] {
  if (!hasSynthesis()) return EMPTY_VOICES;
  const english = window.speechSynthesis
    .getVoices()
    .filter((voice) => voice.lang.toLowerCase().startsWith("en"))
    .map((voice) => ({ uri: voice.voiceURI, name: voice.name, lang: voice.lang }));
  const key = english.map((voice) => voice.uri).join("|");
  // useSyncExternalStore requires a stable snapshot reference between calls.
  if (key !== cachedKey) {
    cachedKey = key;
    cachedVoices = english;
  }
  return cachedVoices;
}

function subscribeVoices(onChange: () => void): () => void {
  if (!hasSynthesis()) return () => undefined;
  window.speechSynthesis.addEventListener("voiceschanged", onChange);
  return () => window.speechSynthesis.removeEventListener("voiceschanged", onChange);
}

const noopSubscribe = () => () => undefined;

function pickDefaultVoice(voices: readonly VoiceOption[]): string {
  const preferred =
    voices.find((voice) => voice.lang === "en-US" && /natural|google|samantha|aria|jenny/i.test(voice.name)) ??
    voices.find((voice) => voice.lang === "en-US") ??
    voices[0];
  return preferred?.uri ?? "";
}

// ---- Cartesia audio cache (object URLs of real audio returned by our /api/tts) ----

const AUDIO_CACHE_LIMIT = 40;
const audioCache = new Map<string, string>();

function cacheAudio(text: string, url: string): void {
  audioCache.set(text, url);
  while (audioCache.size > AUDIO_CACHE_LIMIT) {
    const oldest = audioCache.keys().next().value;
    if (oldest === undefined) break;
    const oldUrl = audioCache.get(oldest);
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    audioCache.delete(oldest);
  }
}

export interface Playback {
  id: string;
  status: "loading" | "playing";
  /** Which engine actually produces this audio. */
  engine: TtsProvider;
  rate: number;
}

export interface PlayOptions {
  /** Overrides the global speed for this playback only (e.g. 🐢 0.7×). */
  rate?: number;
  /** Called when playback finished or failed — not when it was stopped by the user. */
  onDone?: (result: "ended" | "error") => void;
}

export interface SpeechControls {
  /** null while detecting. */
  provider: TtsProvider | null;
  /** Name of the server voice engine (e.g. "ElevenLabs через OmniRoute"). */
  providerLabel: string | null;
  /** Label for a playback engine, for honest UI captions. */
  engineLabel: (engine: TtsProvider) => string;
  /** null until hydrated. */
  browserSupported: boolean | null;
  voices: VoiceOption[];
  voiceUri: string;
  setVoiceUri: (uri: string) => void;
  playback: Playback | null;
  error: string | null;
  /** Shown when Cartesia failed and the browser voice was used instead. */
  notice: string | null;
  play: (id: string, text: string, options?: PlayOptions) => void;
  stop: () => void;
}

export function useSpeech(globalRate: number): SpeechControls {
  const browserSupported = useSyncExternalStore<boolean | null>(noopSubscribe, hasSynthesis, () => null);
  const voices = useSyncExternalStore(subscribeVoices, readVoices, () => EMPTY_VOICES);
  const [provider, setProvider] = useState<TtsProvider | null>(null);
  const [providerLabel, setProviderLabel] = useState<string | null>(null);
  const [chosenUri, setVoiceUri] = useState("");
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fetchRef = useRef<AbortController | null>(null);
  // Chrome may garbage-collect an unreferenced utterance and never fire `end`.
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  /** Increments on every play/stop so stale callbacks can be ignored. */
  const tokenRef = useRef(0);

  const voiceUri = voices.some((voice) => voice.uri === chosenUri) ? chosenUri : pickDefaultVoice(voices);

  useEffect(() => {
    let cancelled = false;
    fetchTtsStatus().then((status) => {
      if (cancelled) return;
      setProvider(status.provider);
      setProviderLabel(status.label);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      tokenRef.current += 1;
      fetchRef.current?.abort();
      audioRef.current?.pause();
      if (hasSynthesis()) window.speechSynthesis.cancel();
    },
    [],
  );

  const stop = useCallback(() => {
    tokenRef.current += 1;
    fetchRef.current?.abort();
    fetchRef.current = null;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
    }
    utteranceRef.current = null;
    if (hasSynthesis()) window.speechSynthesis.cancel();
    setPlayback(null);
  }, []);

  const speakWithBrowser = useCallback(
    (token: number, id: string, text: string, rate: number, onDone?: PlayOptions["onDone"]) => {
      if (!hasSynthesis()) {
        setPlayback(null);
        setError("Озвучивание недоступно в этом браузере.");
        onDone?.("error");
        return;
      }
      const synth = window.speechSynthesis;
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      const voice = synth.getVoices().find((item) => item.voiceURI === voiceUri);
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang ?? "en-US";
      // SpeechSynthesisUtterance.rate is the supported way to change browser speech speed.
      utterance.rate = rate;

      utterance.onstart = () => {
        if (tokenRef.current === token) setPlayback({ id, status: "playing", engine: "browser", rate });
      };
      utterance.onend = () => {
        if (tokenRef.current !== token) return;
        utteranceRef.current = null;
        setPlayback(null);
        onDone?.("ended");
      };
      utterance.onerror = (event) => {
        if (tokenRef.current !== token) return;
        utteranceRef.current = null;
        setPlayback(null);
        if (event.error === "interrupted" || event.error === "canceled") return;
        setError(
          event.error === "not-allowed"
            ? "Браузер заблокировал автоматическое озвучивание. Нажмите «Прослушать»."
            : "Не удалось озвучить текст голосом браузера.",
        );
        onDone?.("error");
      };
      utteranceRef.current = utterance;
      setPlayback({ id, status: "playing", engine: "browser", rate });
      synth.speak(utterance);
    },
    [voiceUri],
  );

  const serverEngine: TtsProvider = provider === "omniroute" ? "omniroute" : "cartesia";

  const playAudioUrl = useCallback(
    async (token: number, id: string, url: string, rate: number, onDone?: PlayOptions["onDone"]) => {
      // A fresh element per playback: no stale handlers from a previous clip (stop() pauses the old one).
      const audio = new Audio();
      audio.onended = () => {
        if (tokenRef.current !== token) return;
        setPlayback(null);
        onDone?.("ended");
      };
      audio.onerror = () => {
        if (tokenRef.current !== token) return;
        setPlayback(null);
        setError("Браузер не смог воспроизвести полученное аудио.");
        onDone?.("error");
      };
      audio.src = url;
      // Real playback-speed change of the generated audio; pitch is preserved by default in modern browsers.
      audio.preservesPitch = true;
      audio.defaultPlaybackRate = rate;
      audio.playbackRate = rate;
      audioRef.current = audio;
      try {
        await audio.play();
        if (tokenRef.current === token) setPlayback({ id, status: "playing", engine: serverEngine, rate });
      } catch (playError) {
        if (tokenRef.current !== token) return;
        setPlayback(null);
        setError(
          playError instanceof DOMException && playError.name === "NotAllowedError"
            ? "Браузер заблокировал автоматическое воспроизведение. Нажмите «Прослушать»."
            : "Не удалось воспроизвести аудио.",
        );
        onDone?.("error");
      }
    },
    [serverEngine],
  );

  const play = useCallback(
    (id: string, rawText: string, options: PlayOptions = {}) => {
      const text = rawText.trim().slice(0, MAX_TTS_CHARS);
      if (!text) return;
      stop();
      const token = tokenRef.current;
      const rate = options.rate ?? globalRate;
      setError(null);

      if (provider === null || provider === "browser") {
        setNotice(null);
        speakWithBrowser(token, id, text, rate, options.onDone);
        return;
      }

      const cached = audioCache.get(text);
      if (cached) {
        void playAudioUrl(token, id, cached, rate, options.onDone);
        return;
      }

      setPlayback({ id, status: "loading", engine: serverEngine, rate });
      const controller = new AbortController();
      fetchRef.current = controller;
      fetchTtsAudio(text, controller.signal)
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          cacheAudio(text, url);
          if (tokenRef.current !== token) return;
          setNotice(null);
          void playAudioUrl(token, id, url, rate, options.onDone);
        })
        .catch((fetchError: unknown) => {
          if (tokenRef.current !== token || controller.signal.aborted) return;
          const reason = fetchError instanceof ChatApiError ? fetchError.message : "Серверное озвучивание недоступно.";
          // Honest fallback: the UI labels this as the browser voice, not Cartesia.
          setNotice(`${reason} Ответ озвучен голосом браузера.`);
          speakWithBrowser(token, id, text, rate, options.onDone);
        })
        .finally(() => {
          if (fetchRef.current === controller) fetchRef.current = null;
        });
    },
    [globalRate, playAudioUrl, provider, serverEngine, speakWithBrowser, stop],
  );

  const engineLabel = useCallback(
    (engine: TtsProvider) => (engine === "browser" ? "голос браузера" : (providerLabel ?? "серверный голос")),
    [providerLabel],
  );

  return {
    provider,
    providerLabel,
    engineLabel,
    browserSupported,
    voices,
    voiceUri,
    setVoiceUri,
    playback,
    error,
    notice,
    play,
    stop,
  };
}
