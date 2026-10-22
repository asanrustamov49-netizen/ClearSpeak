import type { PlayOptions, Playback } from "@/hooks/useSpeech";
import type { NewWordInput } from "@/lib/progress";
import type { LevelId, TtsProvider } from "@/lib/types";

/** What message-level components need to look up, save and pronounce words. */
export interface WordTools {
  level: LevelId;
  /** True once the progress store is hydrated (saving is possible). */
  canSave: boolean;
  isSaved: (word: string) => boolean;
  /** Known translation from this session or the saved dictionary, if any. */
  lookup: (word: string) => { translation: string; note: string } | null;
  /** Returns true if the word was newly added. */
  save: (input: NewWordInput) => boolean;
}

export interface PlaybackTools {
  /** Whether any TTS engine is available. */
  available: boolean;
  playback: Playback | null;
  play: (id: string, text: string, options?: PlayOptions) => void;
  stop: () => void;
  engineLabel: (engine: TtsProvider) => string;
}
