export type LevelId = "beginner" | "intermediate" | "advanced";

export type TopicId =
  | "daily-life"
  | "travel"
  | "job-interview"
  | "restaurant"
  | "free-conversation"
  /** Talking about a generated image (not shown in the scenario picker). */
  | "image-talk";

export type ChatRole = "user" | "assistant";

/** One turn of conversation history as sent to the server. */
export interface ChatTurn {
  role: ChatRole;
  content: string;
}

export interface ChatRequestBody {
  level: LevelId;
  topic: TopicId;
  /** Empty array means "start a new session": the model writes the opening line. */
  messages: ChatTurn[];
  /** Words already introduced or saved, so the model does not repeat them as new. */
  knownWords: string[];
  /** Text description of the image being discussed (produced once by a vision model). */
  imageContext?: ImageContext;
}

export interface ImageContext {
  /** What the learner asked to generate. */
  topic: string;
  /** Factual description from the vision model — the chat model knows the image only through it. */
  description: string;
  keyItems: string[];
}

export interface ImageStatus {
  /** Image generation is configured on the server. */
  generation: boolean;
  /** A vision model is configured for describing images. */
  vision: boolean;
}

/** One line of the NDJSON stream returned by POST /api/chat. */
export type ChatStreamEvent =
  | { type: "delta"; reply: string }
  /** Output failed validation and is being regenerated; discard partial text. */
  | { type: "reset" }
  | { type: "final"; data: CoachReply }
  | { type: "error"; error: ApiErrorBody["error"] };

export interface Correction {
  original: string;
  corrected: string;
  /** Short explanation in Russian. */
  explanation: string;
}

export interface VocabularyItem {
  word: string;
  /** Russian translation or short meaning. */
  translation: string;
  /** Optional short usage note or example (may be empty). */
  note: string;
}

export interface ReplyHint {
  /** Suggested learner reply in English. */
  text: string;
  /** Russian translation. */
  translation: string;
}

/** Validated structured reply produced by the model. */
export interface CoachReply {
  reply: string;
  corrections: Correction[];
  vocabulary: VocabularyItem[];
  /** 2–3 possible next replies for the learner (may be empty if the model omitted them). */
  hints: ReplyHint[];
  /** Model's in-conversation judgement that the scenario goal has been reached. */
  goalAchieved: boolean;
}

export interface TranslateRequestBody {
  level: LevelId;
  /** Word or short phrase the learner tapped. */
  phrase: string;
  /** Sentence or message it came from. */
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
  /** Exact fragment the learner wrote. */
  example: string;
  corrected: string;
  /** Russian explanation of the recurring pattern. */
  explanation: string;
}

export interface SessionSummary {
  topErrors: SummaryError[];
  newWords: Array<{ word: string; translation: string }>;
  nextSessionTip: string;
  goal: { status: GoalStatus; comment: string };
}

/** cartesia = direct Cartesia API; omniroute = /v1/audio/speech through OmniRoute; browser = speechSynthesis. */
export type TtsProvider = "cartesia" | "omniroute" | "browser";

export interface TtsStatus {
  provider: TtsProvider;
  /** Human-readable name of the active voice engine, shown in the UI. */
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
