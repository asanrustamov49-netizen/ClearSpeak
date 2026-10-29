"use client";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { ChatApiError, postChatStream, postSummary } from "@/lib/api";
import { getScenario, MAX_HISTORY_MESSAGES, MAX_KNOWN_WORDS, MAX_USER_MESSAGE_CHARS } from "@/lib/constants";
import type {
  ChatTurn,
  CoachReply,
  Correction,
  ImageContext,
  LevelId,
  ReplyHint,
  SessionSummary,
  TopicId,
  VocabularyItem,
} from "@/lib/types";
import { mergeVocabulary, normalizeWord } from "@/lib/vocabulary";

export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  corrections?: Correction[];
  vocabulary?: VocabularyItem[];
  hints?: ReplyHint[];
}

type Pending = "start" | "send" | null;

export interface SessionError {
  message: string;
  action: "start" | "send";
}

export interface SummaryState {
  status: "idle" | "loading" | "ready" | "error";
  data: SessionSummary | null;
  error: string | null;
}

export interface SessionImage {
  url: string;
  context: ImageContext;
}

export interface SessionState {
  phase: "setup" | "chat" | "summary";
  sessionId: string;
  level: LevelId;
  topic: TopicId;
  messages: UiMessage[];
  vocabulary: VocabularyItem[];
  goalAchieved: boolean;
  pending: Pending;
  streamingText: string | null;
  error: SessionError | null;
  summary: SummaryState;
  image: SessionImage | null;
}

type Action =
  | { type: "setLevel"; level: LevelId }
  | { type: "setTopic"; topic: TopicId }
  | { type: "startRequested"; sessionId: string; image: SessionImage | null }
  | { type: "streamDelta"; text: string | null }
  | { type: "sendRequested"; message: UiMessage }
  | { type: "retryRequested" }
  | { type: "replyReceived"; reply: CoachReply; assistantId: string }
  | { type: "requestFailed"; message: string }
  | { type: "summaryRequested" }
  | { type: "summaryReceived"; summary: SessionSummary }
  | { type: "summaryFailed"; message: string }
  | { type: "backToChat" }
  | { type: "reset" };

const IDLE_SUMMARY: SummaryState = { status: "idle", data: null, error: null };

const initialState: SessionState = {
  phase: "setup",
  sessionId: "",
  level: "intermediate",
  topic: "restaurant",
  messages: [],
  vocabulary: [],
  goalAchieved: false,
  pending: null,
  streamingText: null,
  error: null,
  summary: IDLE_SUMMARY,
  image: null,
};

function withoutUnansweredUser(messages: UiMessage[]): UiMessage[] {
  const last = messages[messages.length - 1];
  return last && last.role === "user" && !last.corrections ? messages.slice(0, -1) : messages;
}

function reducer(state: SessionState, action: Action): SessionState {
  switch (action.type) {
    case "setLevel":
      return state.phase === "setup" ? { ...state, level: action.level } : state;
    case "setTopic":
      return state.phase === "setup" ? { ...state, topic: action.topic } : state;
    case "startRequested":
      return {
        ...initialState,
        level: state.level,
        topic: action.image ? "image-talk" : state.topic,
        sessionId: action.sessionId,
        phase: "chat",
        pending: "start",
        image: action.image,
      };
    case "streamDelta":
      return state.pending ? { ...state, streamingText: action.text } : state;
    case "sendRequested":
      return {
        ...state,
        messages: [...withoutUnansweredUser(state.messages), action.message],
        pending: "send",
        error: null,
        summary: IDLE_SUMMARY,
      };
    case "retryRequested":
      return state.error ? { ...state, pending: state.error.action, error: null } : state;
    case "replyReceived": {
      const { reply } = action;
      const known = new Set(state.vocabulary.map((item) => normalizeWord(item.word)));
      const fresh = reply.vocabulary.filter((item) => !known.has(normalizeWord(item.word)));
      const messages = state.messages.map((message, index) =>
        index === state.messages.length - 1 && message.role === "user"
          ? { ...message, corrections: reply.corrections }
          : message,
      );
      messages.push({
        id: action.assistantId,
        role: "assistant",
        content: reply.reply,
        vocabulary: fresh,
        hints: reply.hints,
      });
      return {
        ...state,
        messages,
        vocabulary: mergeVocabulary(state.vocabulary, fresh),
        goalAchieved: state.goalAchieved || reply.goalAchieved,
        pending: null,
        streamingText: null,
        error: null,
      };
    }
    case "requestFailed":
      return state.pending
        ? { ...state, pending: null, streamingText: null, error: { message: action.message, action: state.pending } }
        : state;
    case "summaryRequested":
      return { ...state, phase: "summary", summary: { status: "loading", data: null, error: null } };
    case "summaryReceived":
      return { ...state, summary: { status: "ready", data: action.summary, error: null } };
    case "summaryFailed":
      return { ...state, summary: { status: "error", data: null, error: action.message } };
    case "backToChat":
      return state.phase === "summary" ? { ...state, phase: "chat" } : state;
    case "reset":
      return { ...initialState, level: state.level, topic: getScenario(state.topic).hidden ? initialState.topic : state.topic };
  }
}

function toHistory(messages: readonly UiMessage[]): ChatTurn[] {
  return messages.slice(-MAX_HISTORY_MESSAGES).map(({ role, content }) => ({ role, content }));
}

function errorMessage(error: unknown): string {
  if (error instanceof ChatApiError) return error.message;
  return "Не удалось получить ответ. Повторите попытку.";
}

export interface ChatSession {
  state: SessionState;
  turns: number;
  setLevel: (level: LevelId) => void;
  setTopic: (topic: TopicId) => void;
  start: (image?: SessionImage) => void;
  send: (text: string) => boolean;
  retry: () => void;
  finish: () => void;
  retrySummary: () => void;
  backToChat: () => void;
  reset: () => void;
}

interface Options {
  onAssistantMessage?: (id: string, text: string) => void;
  onTurnAnswered?: () => void;
  onSummary?: (summary: SessionSummary, state: SessionState) => void;
  savedWords?: readonly string[];
}

export function useChatSession({ onAssistantMessage, onTurnAnswered, onSummary, savedWords = [] }: Options = {}): ChatSession {
  const [state, dispatch] = useReducer(reducer, initialState);
  const busyRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const summaryControllerRef = useRef<AbortController | null>(null);
  const callbacksRef = useRef({ onAssistantMessage, onTurnAnswered, onSummary });

  useEffect(() => {
    callbacksRef.current = { onAssistantMessage, onTurnAnswered, onSummary };
  }, [onAssistantMessage, onTurnAnswered, onSummary]);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
      summaryControllerRef.current?.abort();
    },
    [],
  );

  const knownWords = [...state.vocabulary.map((item) => item.word), ...savedWords.slice(-80)].slice(-MAX_KNOWN_WORDS);

  const run = useCallback(
    (history: ChatTurn[], level: LevelId, topic: TopicId, words: string[], image: SessionImage | null) => {
      busyRef.current = true;
      const controller = new AbortController();
      controllerRef.current = controller;
      const answeringUser = history.length > 0;

      postChatStream(
        { level, topic, messages: history, knownWords: words, ...(image ? { imageContext: image.context } : {}) },
        controller.signal,
        (text) => {
          if (!controller.signal.aborted) dispatch({ type: "streamDelta", text });
        },
      )
        .then((reply) => {
          if (controller.signal.aborted) return;
          const assistantId = crypto.randomUUID();
          dispatch({ type: "replyReceived", reply, assistantId });
          if (answeringUser) callbacksRef.current.onTurnAnswered?.();
          callbacksRef.current.onAssistantMessage?.(assistantId, reply.reply);
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          dispatch({ type: "requestFailed", message: errorMessage(error) });
        })
        .finally(() => {
          if (controllerRef.current === controller) {
            controllerRef.current = null;
            busyRef.current = false;
          }
        });
    },
    [],
  );

  const start = useCallback(
    (image?: SessionImage) => {
      if (busyRef.current) return;
      dispatch({ type: "startRequested", sessionId: crypto.randomUUID(), image: image ?? null });
      run([], state.level, image ? "image-talk" : state.topic, savedWords.slice(-MAX_KNOWN_WORDS), image ?? null);
    },
    [run, savedWords, state.level, state.topic],
  );

  const send = useCallback(
    (text: string): boolean => {
      const content = text.trim();
      if (busyRef.current || state.phase !== "chat" || !content) return false;
      if (content.length > MAX_USER_MESSAGE_CHARS) return false;
      if (!state.messages.some((message) => message.role === "assistant")) return false;

      const message: UiMessage = { id: crypto.randomUUID(), role: "user", content };
      dispatch({ type: "sendRequested", message });
      run(toHistory([...withoutUnansweredUser(state.messages), message]), state.level, state.topic, knownWords, state.image);
      return true;
    },
    [knownWords, run, state.image, state.level, state.messages, state.phase, state.topic],
  );

  const retry = useCallback(() => {
    if (busyRef.current || !state.error) return;
    dispatch({ type: "retryRequested" });
    if (state.error.action === "start") run([], state.level, state.topic, savedWords.slice(-MAX_KNOWN_WORDS), state.image);
    else run(toHistory(state.messages), state.level, state.topic, knownWords, state.image);
  }, [knownWords, run, savedWords, state.error, state.image, state.level, state.messages, state.topic]);

  const requestSummary = useCallback(() => {
    summaryControllerRef.current?.abort();
    const controller = new AbortController();
    summaryControllerRef.current = controller;
    const answered = withoutUnansweredUser(state.messages);
    const snapshot = state;
    dispatch({ type: "summaryRequested" });
    postSummary({ level: state.level, topic: state.topic, messages: toHistory(answered) }, controller.signal)
      .then((summary) => {
        if (controller.signal.aborted) return;
        dispatch({ type: "summaryReceived", summary });
        callbacksRef.current.onSummary?.(summary, snapshot);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        dispatch({ type: "summaryFailed", message: errorMessage(error) });
      })
      .finally(() => {
        if (summaryControllerRef.current === controller) summaryControllerRef.current = null;
      });
  }, [state]);

  const finish = useCallback(() => {
    if (busyRef.current || state.phase !== "chat") return;
    if (!state.messages.some((message) => message.role === "user" && message.corrections)) return;
    if (state.summary.status === "ready") {
      dispatch({ type: "summaryRequested" });
      dispatch({ type: "summaryReceived", summary: state.summary.data as SessionSummary });
      return;
    }
    requestSummary();
  }, [requestSummary, state.messages, state.phase, state.summary]);

  const retrySummary = useCallback(() => {
    if (state.phase === "summary" && state.summary.status === "error") requestSummary();
  }, [requestSummary, state.phase, state.summary.status]);

  const backToChat = useCallback(() => {
    summaryControllerRef.current?.abort();
    dispatch({ type: "backToChat" });
  }, []);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    summaryControllerRef.current?.abort();
    busyRef.current = false;
    dispatch({ type: "reset" });
  }, []);

  const setLevel = useCallback((level: LevelId) => dispatch({ type: "setLevel", level }), []);
  const setTopic = useCallback((topic: TopicId) => dispatch({ type: "setTopic", topic }), []);

  const turns = state.messages.filter((message) => message.role === "user" && message.corrections).length;

  return { state, turns, setLevel, setTopic, start, send, retry, finish, retrySummary, backToChat, reset };
}
