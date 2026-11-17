// swipe-callbacks — the mutable callback contract between the Feed deck UI and
// the signal-persistence layer. It ships NO-OP defaults so the deck
// is fully interactive without any persistence; the persistence layer replaces `swipeCallbacks`'s
// members with the real signal writers + Mera invocation.
//
// Kept as a single mutable object (rather than prop-drilling) so the persistence layer can wire the
// persistence layer in one place without touching the deck components. The deck
// imports `swipeCallbacks` and calls its methods; the persistence layer assigns real functions onto
// it (e.g. `Object.assign(swipeCallbacks, realImpl)`), or replaces individual
// members.

import type { Verdict } from '@/lib/stores/feed-order-store';
import type { ForYouSuggestion } from '@/lib/stores/for-you-store';
import type { FeedbackAnswersHandoff } from '@/lib/news-harness/core/types';

export type { Verdict };

export interface SwipeCallbacks {
  /** A verdict was recorded for a card (quick swipe OR a VerdictBar pill tap). */
  onVerdict: (suggestion: ForYouSuggestion, verdict: Verdict) => void;
  /** Tell Mera from a card's feedback sheet: the chat opens primed with
   *  every answer the reader gave so far. */
  onInvokeMera: (
    suggestion: ForYouSuggestion,
    verdict: Verdict,
    path: string[],
    answers?: FeedbackAnswersHandoff,
  ) => void;
  /** The VerdictBar's Mera icon was tapped — open the DEFAULT article chat
   *  (pinned card + starter chips, NO verdict/path, NO auto-sent message). */
  onOpenArticleChat: (suggestion: ForYouSuggestion) => void;
}

/** Live contract object. No-op defaults; the persistence layer fills the members. */
export const swipeCallbacks: SwipeCallbacks = {
  onVerdict: () => {},
  onInvokeMera: () => {},
  onOpenArticleChat: () => {},
};
