import type { LevelId, TopicId } from "./types";

export interface LevelOption {
  id: LevelId;
  label: string;
  hint: string;
}

export interface Scenario {
  id: TopicId;
  label: string;
  emoji: string;
  goal: string | null;
  aiRole: string;
  userRole: string;
  successCriteria: string | null;
  hidden?: boolean;
}

export const LEVELS: readonly LevelOption[] = [
  { id: "beginner", label: "Beginner", hint: "Простые слова и короткие фразы" },
  { id: "intermediate", label: "Intermediate", hint: "Живая повседневная речь" },
  { id: "advanced", label: "Advanced", hint: "Идиомы, нюансы, сложные темы" },
];

export const SCENARIOS: readonly Scenario[] = [
  {
    id: "restaurant",
    label: "Restaurant",
    emoji: "🍝",
    goal: "Закажите стейк средней прожарки и попросите раздельный счёт.",
    aiRole: "a friendly waiter at a steakhouse",
    userRole: "a guest dining with a friend",
    successCriteria:
      "The learner orders a steak and specifies medium doneness (e.g. 'medium'), AND asks to split the bill / pay separately.",
  },
  {
    id: "travel",
    label: "Travel",
    emoji: "✈️",
    goal: "Спросите дорогу до нужного места и уточните стоимость поездки.",
    aiRole: "a helpful local at a city bus stop who knows the area",
    userRole: "a tourist who needs to get to a specific place in the city",
    successCriteria:
      "The learner asks how to get to a specific destination, AND asks how much the trip/ticket/fare costs.",
  },
  {
    id: "job-interview",
    label: "Job Interview",
    emoji: "💼",
    goal: "Расскажите о своих навыках и приведите пример решения проблемы.",
    aiRole: "a professional hiring manager interviewing a candidate",
    userRole: "a job candidate",
    successCriteria:
      "The learner describes at least one of their skills, AND gives a concrete example of a problem they solved (situation and what they did).",
  },
  {
    id: "daily-life",
    label: "Daily Life",
    emoji: "☕",
    goal: "Договоритесь о встрече и уточните время и место.",
    aiRole: "a friend the learner has not seen for a while",
    userRole: "a friend who wants to meet up",
    successCriteria: "The learner arranges to meet AND both a specific time and a specific place are agreed.",
  },
  {
    id: "free-conversation",
    label: "Free Conversation",
    emoji: "💬",
    goal: null,
    aiRole: "a curious, friendly conversation partner",
    userRole: "a learner chatting about anything they like",
    successCriteria: null,
  },
  {
    id: "image-talk",
    label: "Image Talk",
    emoji: "🖼️",
    goal: "Опишите изображение: место, людей или предметы, действия и атмосферу.",
    aiRole: "a friendly conversation partner looking at the same picture as the learner",
    userRole: "a learner describing a picture",
    successCriteria:
      "The learner describes the place or setting, at least one person or object, at least one action, AND the mood or atmosphere of the image.",
    hidden: true,
  },
];

export const VISIBLE_SCENARIOS: readonly Scenario[] = SCENARIOS.filter((scenario) => !scenario.hidden);
export const TOPICS = SCENARIOS;
export const LEVEL_IDS: readonly LevelId[] = LEVELS.map((level) => level.id);
export const TOPIC_IDS: readonly TopicId[] = SCENARIOS.map((scenario) => scenario.id);

export function getScenario(id: TopicId): Scenario {
  return SCENARIOS.find((scenario) => scenario.id === id) ?? SCENARIOS[SCENARIOS.length - 1];
}

export const MAX_USER_MESSAGE_CHARS = 1000;
export const MAX_ASSISTANT_MESSAGE_CHARS = 3000;
export const MAX_HISTORY_MESSAGES = 40;
export const CHAT_CONTEXT_MESSAGES = 16;
export const MAX_REQUEST_BYTES = 64_000;
export const MAX_CORRECTIONS = 3;
export const MAX_VOCABULARY = 3;
export const MAX_HINTS = 3;
export const MAX_KNOWN_WORDS = 40;
export const MAX_WORD_CHARS = 60;
export const MAX_PHRASE_CHARS = 80;
export const MAX_CONTEXT_CHARS = 600;
export const MAX_IMAGE_TOPIC_CHARS = 160;
export const MAX_IMAGE_DESCRIPTION_CHARS = 2500;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_TTS_CHARS = 1000;
export const MIN_SPEECH_RATE = 0.7;
export const MAX_SPEECH_RATE = 1.3;
export const DEFAULT_SPEECH_RATE = 1;
export const SLOW_SPEECH_RATE = 0.7;
