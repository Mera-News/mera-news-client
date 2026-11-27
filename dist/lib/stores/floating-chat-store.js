"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.KEEP_THREAD_MS = void 0;
exports.nextAnswerUnread = nextAnswerUnread;
exports.useFloatingChatUnresolvedCounts = exports.useFloatingChatTopicPlanTurnRequest = exports.useFloatingChatToolCallResults = exports.useFloatingChatStore = exports.useFloatingChatShown = exports.useFloatingChatSettledTopicPlans = exports.useFloatingChatResolvedProposals = exports.useFloatingChatResolvedConflicts = exports.useFloatingChatQuickFactChecks = exports.useFloatingChatProposal = exports.useFloatingChatPendingDraft = exports.useFloatingChatIsGenerating = exports.useFloatingChatIsExpanded = exports.useFloatingChatHasUnresolvedTopicPlans = exports.useFloatingChatFactMutationVersion = exports.useFloatingChatDiscardedTopicPlans = exports.useFloatingChatConversationId = exports.useFloatingChatAnswerUnread = void 0;
var _zustand = require("zustand");
var _shallow = require("zustand/react/shallow");
var _topicPlanNotes = require("../news-harness/persona-management/topic-plan-notes");
/** Terminal resolution of a save-time fact conflict. */

/**
 * One fact check the user started by tapping a pill on the claim card.
 *
 * IN-MEMORY AND EPHEMERAL, deliberately. A quick answer is a web summary that
 * was true when it was fetched; it is not a stored verdict, it is never written
 * to the `fact_checks` table, and it dies with the thread. Persisting it here
 * would be a second, weaker source of "what has been checked" competing with the
 * Dashboard, which shows only server-checked rows.
 *
 * `mode: 'article'` is the always-last pill — the SERVER-side check of the whole
 * article. Its entry never carries an answer; the Dashboard carries that.
 */

/**
 * The page the Mera button was tapped on, as a chat-pool key (World and every
 * country share `world`; Saved and Visited share `library`). Drives the
 * client-side intro and starters only: it never reaches the model.
 */

/** A follow card's More options request: running, or how the last one ended. */
/** `webLoading`: Regenerate with web search is running. */

const DEFAULT_CONTEXT = {
  kind: 'persona'
};

/** A reopen this soon after a close keeps the thread across a page change. */
const KEEP_THREAD_MS = exports.KEEP_THREAD_MS = 10 * 60 * 1000;
const initialState = {
  isExpanded: false,
  context: DEFAULT_CONTEXT,
  bubbleCenter: {
    x: 0,
    y: 0
  },
  closedAt: null,
  pendingDraft: null,
  interruptedTurn: null,
  isGenerating: false,
  answerUnread: false,
  chatShown: false,
  factMutationVersion: 0,
  pendingInitialMessage: null,
  proposal: null,
  resolvedProposals: {},
  settledTopicPlans: {},
  discardedTopicPlans: {},
  resolvedConflicts: {},
  unresolvedTopicPlanCount: 0,
  unresolvedFactChoiceCount: 0,
  toolCallResults: {},
  topicPlanNotes: [],
  topicPlanTurnRequest: null,
  topicPlanTurnInFlight: false,
  quickFactChecks: [],
  conversationId: null,
  trackTicks: {},
  trackMore: {}
};

/** The open must keep the current thread: a turn is busy or its answer is
 *  unread. */
function threadHeld(state) {
  return state.isGenerating || state.answerUnread;
}

/** Unread is set when a turn ends while the chat is closed, and kept until
 *  the chat opens. */
function nextAnswerUnread(state, generating) {
  if (state.isGenerating && !generating && !state.isExpanded) return true;
  return state.answerUnread && !state.isExpanded;
}

/** True if two contexts differ in kind, target id or (persona) page. */
function contextDiffers(a, b) {
  if (a.kind !== b.kind) return true;
  if (a.kind === 'persona' && b.kind === 'persona') return a.page !== b.page;
  if (a.kind === 'article-suggestion' && b.kind === 'article-suggestion') {
    return a.articleId !== b.articleId || a.suggestionId !== b.suggestionId || a.verdict !== b.verdict || (a.treePath ?? []).join('') !== (b.treePath ?? []).join('') || JSON.stringify(a.feedbackAnswers ?? null) !== JSON.stringify(b.feedbackAnswers ?? null);
  }
  return false;
}
const useFloatingChatStore = exports.useFloatingChatStore = (0, _zustand.create)((set, get) => ({
  ...initialState,
  expand: (context, opts) => {
    // Mera News Free USED to no-op here, so a locked user's tap did
    // nothing at all. It now OPENS: the popup is how the free tier is
    // explained, in Mera's own voice, on the surface the user actually
    // touched. Everything that made opening unsafe is gated deeper —
    // ChatSessionView refuses to dispatch a turn and mounts no engine — so
    // there is nothing left for this chokepoint to protect.
    set(state => {
      // A turn still running, or an answer nobody has read: the open
      // shows THAT thread, whatever the page, kind or elapsed time. A
      // new context here would start a new conversation under a turn
      // still writing to this one, and the ring would point at nothing.
      if (threadHeld(state)) {
        return {
          isExpanded: true,
          answerUnread: false,
          pendingDraft: opts?.draft ?? null
        };
      }
      // Switching to a different context must start a fresh thread so a
      // stale persona chat never bleeds into an article-feedback session.
      // Nulling conversationId is the level-triggered "create a
      // conversation" signal MeraChatSession watches; unlike a nonce it
      // can't be swallowed by mount order. Also drop any pending auto-send
      // (a prior thumbs-down message must not leak into the new thread)
      // and any staged proposal (must not leak across articles).
      //
      // A PAGE change between two persona chats keeps the thread when the
      // chat closed less than KEEP_THREAD_MS ago or a proposal card is
      // still waiting; the new page's starters show
      // under it. A change of kind or target always starts fresh.
      const keepsThread = context !== undefined && context.kind === 'persona' && state.context.kind === 'persona' && (state.proposal !== null || state.closedAt !== null && Date.now() - state.closedAt < KEEP_THREAD_MS);
      const switching = context !== undefined && contextDiffers(context, state.context) && !keepsThread;
      return {
        isExpanded: true,
        answerUnread: false,
        context: context ?? state.context,
        pendingDraft: opts?.draft ?? null,
        ...(switching ? {
          conversationId: null,
          pendingInitialMessage: null,
          proposal: null,
          quickFactChecks: [],
          topicPlanNotes: [],
          topicPlanTurnRequest: null
        } : {})
      };
    });
  },
  openArticleFeedback: (context, initialMessage) => {
    // A held thread opens as it is and the seed is dropped (see `expand`).
    if (threadHeld(get())) {
      set({
        isExpanded: true,
        answerUnread: false
      });
      return;
    }
    set(() => ({
      context,
      pendingInitialMessage: initialMessage,
      isExpanded: true,
      proposal: null,
      quickFactChecks: [],
      topicPlanNotes: [],
      topicPlanTurnRequest: null,
      // Null id = "create a fresh conversation" (fresh thread per thumbs
      // tap). The zustand set is atomic, so the null id and the pending
      // message land in one commit — the old thread unmounts before its
      // auto-send effect could consume the message into the OLD
      // conversation.
      conversationId: null
    }));
  },
  openOptimisationPlan: () => {
    if (threadHeld(get())) {
      set({
        isExpanded: true,
        answerUnread: false
      });
      return;
    }
    // Opens on the free tier too (see `expand`); the plan card itself
    // loads nothing for a locked user and the opener explains why.
    set(() => ({
      // Fresh thread showing only the plan card (no auto-send). Null id is
      // the "create a fresh conversation" signal MeraChatSession watches.
      context: {
        kind: 'optimisation-plan'
      },
      isExpanded: true,
      pendingInitialMessage: null,
      proposal: null,
      quickFactChecks: [],
      topicPlanNotes: [],
      topicPlanTurnRequest: null,
      conversationId: null
    }));
  },
  consumePendingDraft: () => {
    const draft = get().pendingDraft;
    if (draft !== null) set({
      pendingDraft: null
    });
    return draft;
  },
  consumePendingInitialMessage: () => {
    const msg = get().pendingInitialMessage;
    if (msg !== null) set({
      pendingInitialMessage: null
    });
    return msg;
  },
  setProposal: p => set({
    proposal: p
  }),
  resolveProposal: status => set(state => {
    if (!state.proposal) return {};
    return {
      proposal: null,
      resolvedProposals: {
        ...state.resolvedProposals,
        [state.proposal.id]: status
      }
    };
  }),
  setTopicPlanSettled: factId => set(state => ({
    settledTopicPlans: {
      ...state.settledTopicPlans,
      [factId]: true
    }
  })),
  setTopicPlanDiscarded: factId => set(state => ({
    discardedTopicPlans: {
      ...state.discardedTopicPlans,
      [factId]: true
    }
  })),
  setUnresolvedTopicPlanCount: count => set(state =>
  // Guarded so the publishing effect can run on every render without
  // notifying subscribers (and re-rendering the onboarding wizard)
  // when nothing changed.
  state.unresolvedTopicPlanCount === count ? {} : {
    unresolvedTopicPlanCount: count
  }),
  setUnresolvedFactChoiceCount: count => set(state => state.unresolvedFactChoiceCount === count ? {} : {
    unresolvedFactChoiceCount: count
  }),
  setToolCallResult: (key, result) => set(state => ({
    toolCallResults: {
      ...state.toolCallResults,
      [key]: result
    }
  })),
  setTrackTicks: (proposalId, keys) => set(state => ({
    trackTicks: {
      ...state.trackTicks,
      [proposalId]: keys
    }
  })),
  setTrackMore: (proposalId, more) => set(state => {
    const next = {
      ...state.trackMore
    };
    if (more) next[proposalId] = more;else delete next[proposalId];
    return {
      trackMore: next
    };
  }),
  addTopicPlanNote: note => set(state => ({
    topicPlanNotes: [...state.topicPlanNotes, note].slice(-_topicPlanNotes.MAX_TOPIC_PLAN_NOTES)
  })),
  // Date.now() is fine as a nonce here: it only has to DIFFER from the last
  // one the view fired, and two discards cannot land in the same millisecond
  // through a sequential await loop.
  requestTopicPlanTurn: () => set({
    topicPlanTurnRequest: Date.now()
  }),
  clearTopicPlanTurnRequest: () => set({
    topicPlanTurnRequest: null
  }),
  setTopicPlanTurnInFlight: value => set(state => state.topicPlanTurnInFlight === value ? {} : {
    topicPlanTurnInFlight: value
  }),
  beginQuickFactCheck: entry => set(state => ({
    quickFactChecks: [...state.quickFactChecks, entry]
  })),
  settleQuickFactCheck: (id, outcome) => set(state => ({
    quickFactChecks: state.quickFactChecks.map(e => e.id === id ? {
      ...e,
      ...outcome,
      status: 'done'
    } : e)
  })),
  resolveConflict: (conflictKey, resolution) => set(state => ({
    resolvedConflicts: {
      ...state.resolvedConflicts,
      [conflictKey]: resolution
    }
  })),
  collapse: () => set(state => state.isExpanded ? {
    isExpanded: false,
    closedAt: Date.now()
  } : {}),
  toggle: () => set(state => state.isExpanded ? {
    isExpanded: false,
    closedAt: Date.now()
  } : {
    isExpanded: true,
    answerUnread: false
  }),
  setBubbleCenter: c => set({
    bubbleCenter: c
  }),
  setGenerating: v => set(state => ({
    isGenerating: v,
    answerUnread: nextAnswerUnread(state, v)
  })),
  setChatShown: v => set({
    chatShown: v
  }),
  notifyFactMutation: () => set(state => ({
    factMutationVersion: state.factMutationVersion + 1
  })),
  setConversationId: id => set({
    conversationId: id
  }),
  // The nonce MUST die here. A discard parked behind an unresolved sibling
  // card would otherwise fire its "you rejected my topics" reply into the
  // brand-new conversation this call is creating.
  requestNewChat: () => set({
    conversationId: null,
    // Like every other fresh-thread path: a card left waiting must not
    // follow the reader into the new chat, where nothing shows it but
    // the next turn's state line still says one is waiting.
    proposal: null,
    quickFactChecks: [],
    topicPlanNotes: [],
    topicPlanTurnRequest: null,
    // The killed turn's Retry goes with the thread the reader left.
    interruptedTurn: null
  }),
  setInterruptedTurn: interruptedTurn => set({
    interruptedTurn
  }),
  reset: () => set({
    ...initialState
  })
}));

// Selector hooks for optimized subscriptions
const useFloatingChatIsExpanded = () => useFloatingChatStore(state => state.isExpanded);
exports.useFloatingChatIsExpanded = useFloatingChatIsExpanded;
const useFloatingChatFactMutationVersion = () => useFloatingChatStore(state => state.factMutationVersion);
exports.useFloatingChatFactMutationVersion = useFloatingChatFactMutationVersion;
const useFloatingChatIsGenerating = () => useFloatingChatStore(state => state.isGenerating);
exports.useFloatingChatIsGenerating = useFloatingChatIsGenerating;
const useFloatingChatAnswerUnread = () => useFloatingChatStore(state => state.answerUnread);
/** The chat is open or still moving: the Mera button stays hidden. */
exports.useFloatingChatAnswerUnread = useFloatingChatAnswerUnread;
const useFloatingChatShown = () => useFloatingChatStore(state => state.isExpanded || state.chatShown);
exports.useFloatingChatShown = useFloatingChatShown;
const useFloatingChatConversationId = () => useFloatingChatStore(state => state.conversationId);
exports.useFloatingChatConversationId = useFloatingChatConversationId;
const useFloatingChatProposal = () => useFloatingChatStore(state => state.proposal);
exports.useFloatingChatProposal = useFloatingChatProposal;
const useFloatingChatResolvedProposals = () => useFloatingChatStore(state => state.resolvedProposals);
exports.useFloatingChatResolvedProposals = useFloatingChatResolvedProposals;
const useFloatingChatSettledTopicPlans = () => useFloatingChatStore(state => state.settledTopicPlans);
exports.useFloatingChatSettledTopicPlans = useFloatingChatSettledTopicPlans;
const useFloatingChatDiscardedTopicPlans = () => useFloatingChatStore(state => state.discardedTopicPlans);
/** Boolean (not the count) so subscribers only re-render when the gate flips.
 *  Covers BOTH card kinds: a fact choice and a topic plan block the same
 *  surfaces for the same reason, and the onboarding wizard needs one signal. */
exports.useFloatingChatDiscardedTopicPlans = useFloatingChatDiscardedTopicPlans;
const useFloatingChatHasUnresolvedTopicPlans = () => useFloatingChatStore(state => state.unresolvedTopicPlanCount > 0 || state.unresolvedFactChoiceCount > 0);
/** The two counts separately, for a caller that must say WHICH card is pending
 *  (the onboarding toast picks its wording from this). */
exports.useFloatingChatHasUnresolvedTopicPlans = useFloatingChatHasUnresolvedTopicPlans;
const useFloatingChatUnresolvedCounts = () => useFloatingChatStore((0, _shallow.useShallow)(state => ({
  topicPlans: state.unresolvedTopicPlanCount,
  factChoices: state.unresolvedFactChoiceCount
})));
exports.useFloatingChatUnresolvedCounts = useFloatingChatUnresolvedCounts;
const useFloatingChatTopicPlanTurnRequest = () => useFloatingChatStore(state => state.topicPlanTurnRequest);
exports.useFloatingChatTopicPlanTurnRequest = useFloatingChatTopicPlanTurnRequest;
const useFloatingChatToolCallResults = () => useFloatingChatStore(state => state.toolCallResults);
exports.useFloatingChatToolCallResults = useFloatingChatToolCallResults;
const useFloatingChatResolvedConflicts = () => useFloatingChatStore(state => state.resolvedConflicts);
exports.useFloatingChatResolvedConflicts = useFloatingChatResolvedConflicts;
const useFloatingChatPendingDraft = () => useFloatingChatStore(state => state.pendingDraft);
exports.useFloatingChatPendingDraft = useFloatingChatPendingDraft;
const useFloatingChatQuickFactChecks = () => useFloatingChatStore(state => state.quickFactChecks);

// ---------------------------------------------------------------------------
// THE PROFILE CHAT'S FACTS DRAFT
// ---------------------------------------------------------------------------
// Every close path (the X, the backdrop, the swipe, a toggle) ends in
// `isExpanded` going false, so the transition is watched here rather than at
// each call site. Opening from Profile fingerprints the facts; any close
// settles that fingerprint and starts the combination pass when facts changed.
// The Profile origin is dropped on close, or a later bubble open (which keeps
// the previous context) would count as a Profile chat.
/** A draft opened in THIS JS context. A draft a kill left open is settled at
 *  the next launch by inference-recover instead, so a plain close never has to
 *  load the service (and WatermelonDB) for a chat that opened none. */
exports.useFloatingChatQuickFactChecks = useFloatingChatQuickFactChecks;
let profileDraftOpen = false;
useFloatingChatStore.subscribe((state, prev) => {
  if (state.isExpanded === prev.isExpanded) return;
  const opening = state.isExpanded && state.context.kind === 'persona' && state.context.origin === 'profile';
  if (!opening && !(profileDraftOpen && !state.isExpanded)) return;
  // LAZY: the service reaches WatermelonDB, which must stay out of every
  // suite that imports this store. The module exists, so Metro bundles it.
  const draft = require("../services/facts-draft-service");
  const report = err => require("../logger").default.captureException(err, {
    tags: {
      area: 'facts-draft'
    }
  });
  if (opening) {
    profileDraftOpen = true;
    void draft.openFactsDraft().catch(report);
    return;
  }
  profileDraftOpen = false;
  // A failed settle leaves the open marker, which the next launch recovers.
  void draft.settleProfileChatClose().catch(report);
  if (state.context.kind === 'persona' && state.context.origin) {
    // Keep the page: dropping it would read as a page change on reopen.
    const context = {
      ...state.context
    };
    delete context.origin;
    useFloatingChatStore.setState({
      context
    });
  }
});