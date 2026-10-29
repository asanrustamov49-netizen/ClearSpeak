import type { PlayOptions, Playback } from "@/hooks/useSpeech";
import type { NewWordInput } from "@/lib/progress";
import type { LevelId, TtsProvider } from "@/lib/types";

export interface WordTools {
  level: LevelId;
  canSave: boolean;
  isSaved: (word: string) => boolean;
  lookup: (word: string) => { translation: string; note: string } | null;
  save: (input: NewWordInput) => boolean;
}

export interface PlaybackTools {
  available: boolean;
  playback: Playback | null;
  play: (id: string, text: string, options?: PlayOptions) => void;
  stop: () => void;
  engineLabel: (engine: TtsProvider) => string;
}
