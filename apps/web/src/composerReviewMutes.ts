import * as Schema from "effect/Schema";

import { useLocalStorage } from "./hooks/useLocalStorage";

const COMPOSER_REVIEW_MUTES_STORAGE_KEY = "t3code:composer-review-mutes:v1";
// Oldest mutes fall off first; a forgotten mute only means one more suggestion.
const MAX_MUTED_THREADS = 500;

const ComposerReviewMutesSchema = Schema.Struct({
  threadKeys: Schema.Array(Schema.String),
});
const EMPTY_MUTES = { threadKeys: [] };

/** Threads where the user muted the prompt coach, keyed by scoped thread key. Local to this device. */
export function useComposerReviewMutes() {
  const [mutes, setMutes] = useLocalStorage(
    COMPOSER_REVIEW_MUTES_STORAGE_KEY,
    EMPTY_MUTES,
    ComposerReviewMutesSchema,
  );
  const mutedThreadKeys = new Set(mutes.threadKeys);

  const muteThread = (threadKey: string) => {
    setMutes((current) =>
      current.threadKeys.includes(threadKey)
        ? current
        : { threadKeys: [...current.threadKeys, threadKey].slice(-MAX_MUTED_THREADS) },
    );
  };

  const unmuteThread = (threadKey: string) => {
    setMutes((current) => ({
      threadKeys: current.threadKeys.filter((key) => key !== threadKey),
    }));
  };

  const unmuteAllThreads = () => setMutes(EMPTY_MUTES);

  return { mutedThreadKeys, muteThread, unmuteThread, unmuteAllThreads };
}
