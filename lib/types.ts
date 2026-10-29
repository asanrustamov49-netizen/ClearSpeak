export type LevelId = "beginner" | "intermediate" | "advanced";

export type TopicId =
  | "daily-life"
  | "travel"
  | "job-interview"
  | "restaurant"
  | "free-conversation"
  | "image-talk";

export type ChatRole = "user" | "assistant";

export interface ChatTurn {
  role: ChatRole;
  content: string;
}

export interface ChatRequestBody {
  level: LevelId;
  topic: TopicId;
  messages: ChatTurn[];
  knownWords: string[];
  imageContext?: ImageContext;
}

export interface ImageContext {
  topic: string;
  description: string;
  keyItems: string[];
}

export interface ImageStatus {
  generation: boolean;
  vision: boolean;
}

export type ChatStreamEvent =
  | { type: "delta"; reply: string }
  | { type: "reset" }
  | { type: "final"; data: CoachReply }
  | { type: "error"; error: ApiErrorBody["error"] };

export interface Correction {
  original: string;
  corrected: string;
  explanation: string;
}

export interface VocabularyItem {
  word: string;
  translation: string;
  note: string;
}

export interface ReplyHint {
  text: string;
  translation: string;
}

export interface CoachReply {
  reply: string;
  corrections: Correction[];
  vocabulary: VocabularyItem[];
  hints: ReplyHint[];
  goalAchieved: boolean;
}

export interface TranslateRequestBody {
  level: LevelId;
  phrase: string;
  context: string;
}

export interface TranslationResult {
  phrase: string;
  translation: string;
  note: string;
}

export interface HintsRequestBody {
  level: LevelId;
  topic: TopicId;
  messages: ChatTurn[];
}

export interface HintsResult {
  hints: ReplyHint[];
}

export interface SummaryRequestBody {
  level: LevelId;
  topic: TopicId;
  messages: ChatTurn[];
}

export type GoalStatus = "completed" | "partial" | "not_completed" | "not_applicable";

export interface SummaryError {
  example: string;
  corrected: string;
  explanation: string;
}

export interface SessionSummary {
  topErrors: SummaryError[];
  newWords: Array<{ word: string; translation: string }>;
  nextSessionTip: string;
  goal: { status: GoalStatus; comment: string };
}

export type TtsProvider = "cartesia" | "omniroute" | "browser";

export interface TtsStatus {
  provider: TtsProvider;
  label: string;
}

export type ApiErrorCode =
  | "invalid_request"
  | "payload_too_large"
  | "not_configured"
  | "upstream_unreachable"
  | "upstream_auth"
  | "upstream_model"
  | "upstream_rate_limited"
  | "upstream_error"
  | "invalid_model_output"
  | "timeout"
  | "network"
  | "internal";

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
  };
}
