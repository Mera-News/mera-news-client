"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.addProfileOffer = addProfileOffer;
exports.askProfileImpact = askProfileImpact;
exports.dismissTrackCard = dismissTrackCard;
exports.followTickedOptions = followTickedOptions;
exports.growTrackCard = growTrackCard;
exports.loadMoreTrackOptions = loadMoreTrackOptions;
exports.patchTrackCard = patchTrackCard;
exports.recordTrackOutcome = recordTrackOutcome;
exports.regenerateTrackOptions = regenerateTrackOptions;
var _proposalHandlers = require("../../chat-tools/proposal-handlers");
var _conversationService = require("../../database/services/conversation-service");
var _trackActions = require("../../tracking/track-actions");
var _logger = _interopRequireDefault(require("../../logger"));
var _chatSession = require("../chat-session");
var _floatingChatStore = require("../../stores/floating-chat-store");
var _trackOptions = require("./track-options");
var _factChoiceActions = require("./fact-choice-actions");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// track-card-actions: the side-effect half of the follow card. Every write to a
// proposeTrack call's result goes through `patchTrackCard`, the same contract
// as fact-choice-actions: READ the store override (or the staged result on the
// first write), MERGE, WRITE, all synchronously so two writes in a row never
// lose each other, then patch the persisted row fire-and-forget (a row not
// written yet picks the override up at write time, see lib/chat-session).

function trackActions(actions) {
  return actions.filter(a => a.type === 'track_story');
}

/** Merge `patch(current)` into the card's result and persist it. Returns the new result. */
function patchTrackCard(source, patch) {
  const store = _floatingChatStore.useFloatingChatStore.getState();
  const current = store.toolCallResults[source.resultKey] ?? source.baseResult;
  const next = {
    ...current,
    ...patch(current)
  };
  store.setToolCallResult(source.resultKey, next);
  const [messageId, indexRaw] = source.resultKey.split('::');
  const index = Number(indexRaw);
  if (messageId && Number.isInteger(index)) {
    void (0, _conversationService.patchMessageToolCallResult)(messageId, index, next).catch(err => {
      _logger.default.warn('[track-card] durable patch failed', {
        resultKey: source.resultKey,
        error: String(err)
      });
    });
  }
  return next;
}

/**
 * Appends the new options More options returned. Persists the whole list as
 * `cardOptions` and, while this card is the store's waiting proposal, grows
 * that too, so every typed-yes guard reads the effective option count.
 * Returns how many options were added (0 writes nothing).
 *
 * `replace` (Regenerate with web search): the new options take the place of
 * every row the card does not keep (see `keptTrackKeys`). Ticks on kept rows
 * stay; with none left the first new row is ticked.
 */
function growTrackCard(source, proposal, incoming, replace = false) {
  const shown = trackActions(proposal.actions);
  const toOption = a => ({
    label: a.label,
    search: a.searchText
  });
  const before = _floatingChatStore.useFloatingChatStore.getState();
  const current = before.toolCallResults[source.resultKey] ?? source.baseResult;
  const kept = replace ? (0, _trackOptions.keptTrackKeys)(current) : null;
  const base = kept ? shown.filter(a => kept.has((0, _trackOptions.normaliseTrackText)(a.label))) : shown;
  const {
    options,
    added
  } = (0, _trackOptions.mergeTrackOptions)(base.map(toOption), trackActions(incoming).map(toOption));
  if (added === 0 || shown.length === 0) return 0;
  if (kept) {
    const firstNew = (0, _trackOptions.normaliseTrackText)(options[base.length].label);
    const ticks = before.trackTicks[proposal.id];
    if (ticks) {
      const left = ticks.filter(k => kept.has(k));
      before.setTrackTicks(proposal.id, left.length > 0 ? left : [firstNew]);
    }
    const defaultKept = typeof current.defaultTick === 'string' && kept.has(current.defaultTick);
    patchTrackCard(source, () => ({
      cardOptions: options,
      ...(defaultKept ? {} : {
        defaultTick: firstNew
      })
    }));
  } else {
    patchTrackCard(source, () => ({
      cardOptions: options
    }));
  }
  const store = _floatingChatStore.useFloatingChatStore.getState();
  if (store.proposal?.id === proposal.id) {
    // Every option follows the card's own subject, as the resume path rebuilds it.
    const subject = shown[0].subject;
    const actions = options.map(o => ({
      type: 'track_story',
      label: o.label,
      searchText: o.search,
      subject
    }));
    store.setProposal({
      ...store.proposal,
      actions,
      chooseOne: actions.length >= 2 || undefined
    });
  }
  return added;
}

/** Records one row's outcome; called after EACH follow so a crash mid-batch keeps the rows done. */
function recordTrackOutcome(source, label, outcome) {
  patchTrackCard(source, current => ({
    followed: {
      ...(0, _trackOptions.readTrackOutcomes)(current.followed),
      [(0, _trackOptions.normaliseTrackText)(label)]: outcome
    }
  }));
}

/**
 * Follow: the ticked rows in card order, one executor call each, so every row
 * gets its own outcome, written as soon as that row settles (a crash mid-batch
 * keeps the rows already done). One feed sync after the batch, not one per
 * follow. A card left resolved settles the store's waiting proposal.
 */
async function followTickedOptions(source, proposal, tickedLabels) {
  const ticked = new Set(tickedLabels.map(_trackOptions.normaliseTrackText));
  let followedNew = false;
  for (const action of trackActions(proposal.actions)) {
    if (!ticked.has((0, _trackOptions.normaliseTrackText)(action.label))) continue;
    let outcome = 'failed';
    try {
      const r = await (0, _proposalHandlers.executeProposalActions)([action], {
        confirmedByUser: true,
        syncFeed: false
      });
      if (r.applied > 0 && r.errors.length === 0) outcome = r.alreadyFollowed > 0 ? 'already' : 'following';
    } catch {
      // The executor never throws; a failed row is still the honest answer.
    }
    if (outcome === 'following') followedNew = true;
    recordTrackOutcome(source, action.label, outcome);
  }
  if (followedNew) void (0, _trackActions.syncFollowedStoryNow)();
  const store = _floatingChatStore.useFloatingChatStore.getState();
  const current = store.toolCallResults[source.resultKey] ?? source.baseResult;
  const outcomes = (0, _trackOptions.readTrackOutcomes)(current.followed);
  const status = (0, _trackOptions.trackCardStatus)({
    outcomes,
    dismissed: source.dismissed,
    superseded: source.superseded
  });
  if (status === 'followed' && store.proposal?.id === proposal.id) store.resolveProposal('applied');
  return {
    outcomes,
    status
  };
}

/**
 * More options: one engine call built from the card, merged into it. The
 * request state lives in the store (`trackMore`), so a card that unmounts
 * mid-request comes back showing it. A second tap while one runs does nothing.
 * Stopped clears the state (no message); busy or failed reads as failed.
 */
async function loadMoreTrackOptions(source, proposal) {
  const running = loadingState(proposal.id);
  if (running) return {
    added: 0,
    state: running
  };
  _floatingChatStore.useFloatingChatStore.getState().setTrackMore(proposal.id, 'loading');
  const res = await (0, _chatSession.requestMoreOptions)(proposal.id, proposal.actions);
  const added = res.actions.length > 0 ? growTrackCard(source, proposal, res.actions) : 0;
  const state = settledState(added, res.reason);
  _floatingChatStore.useFloatingChatStore.getState().setTrackMore(proposal.id, state);
  return {
    added,
    state
  };
}

/** The request already running on this card, if any: one at a time, of either kind. */
function loadingState(proposalId) {
  const state = _floatingChatStore.useFloatingChatStore.getState().trackMore[proposalId];
  return state === 'loading' || state === 'webLoading' ? state : null;
}
function settledState(added, reason) {
  if (added > 0 || reason === 'stopped') return null;
  return reason === 'failed' || reason === 'busy' ? 'failed' : 'none';
}

/**
 * Regenerate with web search: the device searches the story (`webQueryForCard`),
 * the model writes options from the results, and they replace every row the
 * card does not keep. `firstNew` is the index of the first new row. Same
 * states and one-at-a-time rule as More options.
 */
async function regenerateTrackOptions(source, proposal) {
  const running = loadingState(proposal.id);
  if (running) return {
    added: 0,
    firstNew: 0,
    state: running
  };
  const store = _floatingChatStore.useFloatingChatStore.getState();
  const shown = trackActions(proposal.actions);
  const current = store.toolCallResults[source.resultKey] ?? source.baseResult;
  const kept = (0, _trackOptions.keptTrackKeys)(current);
  const keep = label => kept.has((0, _trackOptions.normaliseTrackText)(label));
  const subject = shown[0]?.subject;
  const query = (0, _trackOptions.webQueryForCard)(current, shown.map(a => ({
    label: a.label,
    search: a.searchText
  })), subject?.title);
  if (!query) {
    store.setTrackMore(proposal.id, 'none');
    return {
      added: 0,
      firstNew: 0,
      state: 'none'
    };
  }
  store.setTrackMore(proposal.id, 'webLoading');
  const res = await (0, _chatSession.requestMoreOptions)(proposal.id, proposal.actions, {
    query,
    keep
  });
  const added = res.actions.length > 0 ? growTrackCard(source, proposal, res.actions, true) : 0;
  const state = settledState(added, res.reason);
  _floatingChatStore.useFloatingChatStore.getState().setTrackMore(proposal.id, state);
  return {
    added,
    firstNew: shown.filter(a => keep(a.label)).length,
    state
  };
}

/** Not now: persisted, and the store's waiting proposal (if this card) is cancelled. */
function dismissTrackCard(source, proposalId) {
  patchTrackCard(source, () => ({
    dismissed: true
  }));
  const store = _floatingChatStore.useFloatingChatStore.getState();
  if (store.proposal?.id === proposalId) store.resolveProposal('cancelled');
}

/**
 * "Add to my profile instead": never a commit. The fixed question joins the
 * thread with no model call, and the reader's answer is an ordinary turn.
 */
async function askProfileImpact(source, question) {
  patchTrackCard(source, () => ({
    profileStep: 'asking'
  }));
  await (0, _chatSession.askImpactQuestion)(question);
}

/**
 * "Add it anyway": Mera recommends and never restricts. Commits as written, so
 * topics run as usual, and settles the store's waiting proposal. Rows already
 * followed stay followed. False leaves the card as it was, to tap again.
 */
async function addProfileOffer(source, proposalId, offer) {
  try {
    const saved = await (0, _factChoiceActions.commitAsWritten)(offer);
    patchTrackCard(source, () => ({
      profileStep: 'added',
      profileSaved: saved
    }));
    const store = _floatingChatStore.useFloatingChatStore.getState();
    if (store.proposal?.id === proposalId) store.resolveProposal('applied');
    return true;
  } catch (err) {
    _logger.default.error('[track-card] add to profile failed', err, {
      resultKey: source.resultKey
    });
    return false;
  }
}