"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.handleTopicGenJob = handleTopicGenJob;
var _factService = require("../../database/services/fact-service");
var _inferenceJobService = require("../../database/services/inference-job-service");
var _topicGenerationService = require("../../mera-protocol/topic-generation-service");
var _floatingChatStore = require("../../stores/floating-chat-store");
var _topicService = require("../../database/services/topic-service");
var _topicDeclineService = require("../../database/services/topic-decline-service");
var _topicGenerationStatusService = require("../../database/services/topic-generation-status-service");
var _factPlaces = require("../../news-harness/persona-management/fact-places");
var _meraHarness = require("../../mera-harness");
var _chatSession = require("../../chat-session/chat-session");
var _factRemoval = require("../../chat-session/fact-removal");
var _cloudComplete = require("../../llm/cloudComplete");
var _onDeviceGate = require("../../llm/on-device-gate");
var _jobDefer = require("../job-defer");
var _gatewayFetch = require("../../llm/gateway-fetch");
var _logger = _interopRequireDefault(require("../../logger"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Handler for topic_gen jobs: ISOLATED topics for one fact, through
// the skill core on cloud and the local engine on device. Combination topics
// come only from the deferred pass (topic-combo-handler.ts), cloud only.

/**
 * The exclusion lists, read at RUN time: THIS FACT's own topics and EVERY
 * declined topic. Other facts' topics are not the isolated call's
 * business; the combination pass dedupes across facts.
 *
 * NOT from the payload. A snapshot taken at enqueue is durable and wrong: a job
 * enqueued before an app kill would replay a stale list days later.
 *
 * Best-effort: a failure degrades to generating without exclusions rather than
 * failing the job, because a fact with no topics is worse than a fact with a
 * near-duplicate.
 */
async function readExclusionsNow(factId) {
  const rows = await (0, _topicService.getByFact)(factId).catch(err => {
    _logger.default.warn('[topic-gen] own-topic read failed', {
      factId,
      error: String(err)
    });
    return null;
  });
  const ownTopics = (rows ?? []
  // NOT combo rows: they name OTHER facts' subjects, and an
  // isolated call shown them drifts onto those subjects.
  ).filter(r => r.status === 'active' && r.provenance !== 'combo').map(r => r.text).filter(Boolean);
  const declined = await (0, _topicDeclineService.getAllDeclinedNormalizedTexts)().catch(err => {
    _logger.default.warn('[topic-gen] declined-topic read failed', {
      factId,
      error: String(err)
    });
    return new Set();
  });
  return {
    ownTopics,
    hasAnyTopics: rows === null || rows.length > 0,
    declined
  };
}

/** What a run may still mint: never a declined text and never one the fact
 *  already owns, both compared in topic-service's normalised form (the core's
 *  own veto only folds case and spaces). */
function freshTopics(topics, ownTopics, declined) {
  const owned = new Set(ownTopics.map(_topicService.normalizeTopicText));
  const seen = new Set();
  return topics.filter(t => {
    const key = (0, _topicService.normalizeTopicText)(t);
    if (!key || owned.has(key) || declined.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
class UnreadableAnswerError extends Error {}

/** The model answered, in a form no parser reads. Unlike a transport failure a
 *  retry costs model calls, so these are the errors that are counted. */
function isUnreadableAnswer(err) {
  return err instanceof UnreadableAnswerError || err instanceof _gatewayFetch.EmptyReplyError || err?.code === 'ERR_STRUCTURED_OUTPUT';
}

/**
 * CLOUD: one terminal call through the skill core, isolated. The guideline is
 * the one the chat turn chose, else the one the fact's attribute implies, else
 * `topics/generic`.
 */
async function runSkillGuided(payload, fact, ownTopics, declined) {
  const out = await (0, _meraHarness.generateTopicsForFact)({
    // Places are read from the fact now, never from the job payload.
    fact: {
      statement: fact.statement,
      questionnaireAttribute: fact.questionnaireAttribute ?? null,
      ...((0, _factPlaces.describeFactPlaces)(fact) ? {
        places: (0, _factPlaces.describeFactPlaces)(fact)
      } : {})
    },
    skillId: payload.skillId ?? (0, _meraHarness.topicSkillForAttribute)(fact.questionnaireAttribute),
    existingTopics: ownTopics,
    declinedTopics: [...declined],
    append: payload.mode === 'append',
    ...(payload.totalCount ? {
      ceiling: payload.totalCount
    } : {}),
    deps: {
      callModel: async req => {
        const started = Date.now();
        const content = await (0, _cloudComplete.cloudComplete)({
          systemPrompt: req.systemPrompt,
          prompt: req.messages[0]?.content ?? '',
          // The core emits a tier label; the router picks the model for the lane.
          route: 'topics',
          temperature: req.temperature,
          maxTokens: req.maxTokens
        }, {
          lane: 'background'
        });
        // A blank reply is the provider failing, not the model finding nothing.
        if (typeof content !== 'string' || !content.trim()) throw new _gatewayFetch.EmptyReplyError();
        return {
          content,
          toolCalls: [],
          finishReason: 'stop',
          truncated: false,
          usage: null,
          modelSent: req.model,
          latencyMs: Date.now() - started,
          error: null
        };
      }
    }
  });
  if (out.dropped.veto > 0 || out.dropped.filter > 0) {
    // Split by cause, so "generated zero" is answerable rather than looking
    // identical to a bad prompt.
    _logger.default.warn('[topic-gen] candidates dropped', {
      factId: payload.factId,
      veto: out.dropped.veto,
      filter: out.dropped.filter,
      kept: out.topics.length
    });
  }
  if (out.malformed) throw new UnreadableAnswerError('Topic generation returned an unreadable answer');
  return {
    topics: out.topics,
    dropped: out.dropped
  };
}

/** What a run reports. Never the statement or a topic text: both are persona content. */
function topicGenFailureContext(payload, fact) {
  return {
    skillId: payload.skillId ?? (0, _meraHarness.topicSkillForAttribute)(fact.questionnaireAttribute),
    attribute: fact.questionnaireAttribute ?? null
  };
}

/**
 * Topics landed, so the first feed can follow them now instead of at the next poll.
 * Lazy, as in combo-pass-service: this sits under the queue every enqueue path imports.
 * shortcut: a busy scheduler drops this and the next poll covers it, upgrade if readers report a wait.
 */
function followWithFeedSync() {
  try {
    const {
      AppScheduler
    } = require("../../scheduler/AppScheduler");
    void AppScheduler.trigger('feed-sync', undefined, {
      bypassDebounce: true
    }).catch(err => _logger.default.warn('[topic-gen] feed-sync trigger failed', {
      error: String(err)
    }));
  } catch (err) {
    _logger.default.captureException(err, {
      tags: {
        service: 'topic-gen',
        method: 'feed-sync'
      }
    });
  }
}

/** Stale means the fact was reworded or deleted while the ladder ran. */
async function currentStatement(factId) {
  return (await (0, _factService.getFacts)()).find(f => f.id === factId)?.statement ?? null;
}
async function handleTopicGenJob(payload) {
  try {
    return await runTopicGen(payload);
  } finally {
    // The last job of a batch fires it, so several empty facts make one reply.
    await (0, _chatSession.flushRemovedFacts)(payload.factId).catch(err => {
      _logger.default.warn('[topic-gen] removal note did not fire', {
        error: String(err)
      });
    });
  }
}
async function runTopicGen(payload) {
  const allFacts = await (0, _factService.getFacts)();
  const fact = allFacts.find(f => f.id === payload.factId);
  // Deleted before its job ran: nothing to generate for and nothing to settle.
  if (!fact) return {
    topics: [],
    outcome: 'nothing-new'
  };
  const {
    ownTopics,
    hasAnyTopics,
    declined
  } = await readExclusionsNow(payload.factId);
  const append = payload.mode === 'append';
  const background = payload.background === true;
  let generated;
  let dropped = {
    veto: 0,
    filter: 0
  };
  try {
    // A job queued in cloud mode runs the on-device branch if the mode has since changed.
    if (payload.useCloud && !(await (0, _onDeviceGate.isOnDeviceMode)())) {
      const run = await runSkillGuided(payload, fact, ownTopics, declined);
      generated = run.topics;
      dropped = run.dropped;
    } else {
      // ON-DEVICE: the local engine's own prompt, isolated the same way. No
      // location line and no other facts: a location drawn from ANOTHER fact
      // anchored a non-place fact to it, which is a combination, and on-device
      // mode has no combination pass (owner decision).
      generated = await (0, _topicGenerationService.generateTopicsForFact)({
        factStatement: fact.statement,
        userLocation: null,
        otherFacts: [],
        useCloud: false,
        totalCount: payload.totalCount,
        excludeTopics: [...ownTopics, ...declined]
      });
    }
  } catch (err) {
    // Offline, no credential yet, or the gateway said busy: the queue retries
    // later without spending an attempt, and the fact stays pending.
    if ((0, _jobDefer.isOnDeviceDeferrable)(err) || (0, _jobDefer.isDeferrableError)(err)) throw err;
    const message = err instanceof Error ? err.message : String(err);
    _logger.default.warn('[topic-gen] run failed', {
      factId: payload.factId,
      message
    });
    // Generate more and a scheduled retry change nothing: the fact's topics and
    // its status are not this run's to touch, and an error is never an empty.
    if (!append && !background) {
      // captureException, not captureMessage: its classifier keeps a dead
      // session, offline or a missing credential out of Sentry.
      _logger.default.captureException(err, {
        level: 'warning',
        fingerprint: ['topic-gen-failed', 'threw'],
        tags: {
          service: 'topic-gen'
        },
        extra: topicGenFailureContext(payload, fact)
      });
      await (0, _topicGenerationStatusService.failTopicGeneration)(payload.factId, message);
    }
    if (background && isUnreadableAnswer(err)) await (0, _topicGenerationStatusService.noteUnreadableLadder)(payload.factId);
    return {
      topics: [],
      outcome: 'error'
    };
  }
  const statement = await currentStatement(payload.factId);
  if (statement !== fact.statement) {
    // The answer is about words the fact no longer says. A first run owes the
    // new wording its own run; the job that asked for it was deduped behind this one.
    if (statement !== null && !append && !background) {
      await (0, _inferenceJobService.enqueueJob)('topic_gen', {
        ...payload,
        factStatement: statement
      });
    }
    return {
      topics: [],
      outcome: 'nothing-new'
    };
  }
  const topics = freshTopics(generated, ownTopics, declined);
  // Persona content, so DEBUG only: console under EXPO_PUBLIC_VERBOSE_LOGS, a breadcrumb in dev builds, nothing in prod.
  _logger.default.debug('[topic-gen] generated', {
    fact: fact.statement,
    returned: generated,
    kept: topics
  });
  if (topics.length > 0) {
    await (0, _topicGenerationStatusService.completeTopicGeneration)(payload.factId, topics);
    _floatingChatStore.useFloatingChatStore.getState().notifyFactMutation();
    followWithFeedSync();
    return {
      topics,
      outcome: 'added'
    };
  }
  if (append) {
    await (0, _topicGenerationStatusService.settleEmptyTopicGeneration)(payload.factId, fact.statement, {
      onlyIfClockRunning: true
    });
    return {
      topics: [],
      outcome: 'nothing-new'
    };
  }
  if (hasAnyTopics) {
    await (0, _topicGenerationStatusService.markTopicGenerationSettled)([payload.factId]);
    return {
      topics: [],
      outcome: 'nothing-new'
    };
  }
  // No capture: an empty answer is a normal state now. The split still reads
  // from a breadcrumb: "the model said nothing" against "a filter ate everything".
  _logger.default.warn('[topic-gen] settled empty', {
    ...topicGenFailureContext(payload, fact),
    coreReturned: generated.length,
    veto: dropped.veto,
    filter: dropped.filter
  });
  await (0, _topicGenerationStatusService.settleEmptyTopicGeneration)(payload.factId, fact.statement, {
    background
  });
  if (!background) await (0, _factRemoval.resolveEmptyChatFact)(payload.factId, fact.statement);
  _floatingChatStore.useFloatingChatStore.getState().notifyFactMutation();
  return {
    topics: [],
    outcome: 'empty'
  };
}