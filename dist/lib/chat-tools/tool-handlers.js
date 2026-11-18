"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
Object.defineProperty(exports, "MAX_FACT_LENGTH", {
  enumerable: true,
  get: function () {
    return _factRules.MAX_FACT_LENGTH;
  }
});
exports.handleDeleteUserFacts = handleDeleteUserFacts;
exports.handleExplainMera = handleExplainMera;
exports.handleIssueWarning = handleIssueWarning;
exports.handleSaveExtractedFacts = handleSaveExtractedFacts;
exports.handleUpdateUserConfig = handleUpdateUserConfig;
exports.retryTopicGeneration = void 0;
exports.startTopicGeneration = startTopicGeneration;
exports.triggerTopicGeneration = triggerTopicGeneration;
var _factService = require("../database/services/fact-service");
var _settingService = require("../database/services/setting-service");
var _accountService = require("../account-service");
var _floatingChatStore = require("../stores/floating-chat-store");
var _meraProtocolStore = require("../stores/mera-protocol-store");
var _userStore = require("../stores/user-store");
var _graphqlTypes = require("../generated/graphql-types");
var _inferenceJobService = require("../database/services/inference-job-service");
var _InferenceQueue = require("../inference/InferenceQueue");
var _logger = _interopRequireDefault(require("../logger"));
var _factRules = require("../news-harness/persona-management/fact-rules");
var _factChoiceResolution = require("./fact-choice-resolution");
var _topicGenerationStatusService = require("../database/services/topic-generation-status-service");
var _readingPlans = require("../subscription/reading-plans");
var _command = require("../sync/command");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Shared Tool Handlers — Used by both on-device LLM and cloud inference chat paths.
// Extracted from on-device-chat-agent.ts so both paths share identical tool execution logic.

// MAX_FACT_LENGTH's canonical home is the harness fact-rules module; re-exported
// here so existing importers of it from tool-handlers keep working.

/** How many sections one `explainMera` call may return.
 *
 *  A 3-section answer is already the single largest entry the CLOUD history
 *  budget will carry, so a model asking for all eight is capped rather than
 *  refused: an error there would burn a whole round trip to teach the model
 *  something the first three sections already answer. */
const MAX_EXPLAINER_SECTIONS = 3;

/**
 * `explainMera` — returns Mera's own reference documentation for the model to
 * answer from, so a question about privacy, encryption, the licence or the
 * known gaps is answered from sourced text instead of from memory.
 *
 * Pure read: no database, no network, no side effects. The ~15KB prose module
 * is `require`d LAZILY here (mirroring PersonaUpdateAgent.loadKnownPublicationNames)
 * so it never enters app startup evaluation — it is only ever needed on a turn
 * where the user actually asked.
 *
 * An unknown id returns `{ error, availableTopics }` rather than a partial
 * answer or an empty list: the model can then retry with a real id, which is
 * strictly better than it inventing a guarantee to fill the gap. That is also
 * why a missing/empty `topics` is an error and not a silent default.
 */
async function handleExplainMera(args) {
  const {
    MERA_EXPLAINER_SECTIONS,
    PLAN_SIZES_TOKEN
  } =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("../news-harness/prompts/mera-explainer-content");
  const availableTopics = Object.keys(MERA_EXPLAINER_SECTIONS);
  const requested = args.topics;
  if (!Array.isArray(requested) || requested.length === 0) {
    return {
      error: 'topics must be a non-empty array of topic ids',
      availableTopics
    };
  }
  const capped = requested.slice(0, MAX_EXPLAINER_SECTIONS);
  const unknown = capped.filter(t => typeof t !== 'string' || !availableTopics.includes(t));
  if (unknown.length > 0) {
    return {
      error: `Unknown topic(s): ${unknown.map(t => String(t)).join(', ')}`,
      availableTopics
    };
  }

  // De-duplicated, order preserved: a repeated id would otherwise pay for the
  // same section twice out of a budget where these are the largest entries.
  const seen = new Set();
  const sections = capped.filter(t => seen.has(t) ? false : (seen.add(t), true)).map(topic => ({
    topic,
    text: MERA_EXPLAINER_SECTIONS[topic].replace(PLAN_SIZES_TOKEN, planSizesSentence())
  }));
  return {
    sections
  };
}

/** The plan sizes as the server enforces them, as one sentence for the explainer; empty while unknown. */
function planSizesSentence() {
  const plans = (0, _readingPlans.getReadingPlans)();
  if (!plans) return '';
  const less = (0, _readingPlans.planRatio)(plans.individual, plans.starter);
  const more = (0, _readingPlans.planRatio)(plans.professional, plans.individual);
  return ` Today they are: Individual ${(0, _readingPlans.formatMb)(plans.individual)}, Starter ${(0, _readingPlans.formatMb)(plans.starter)}` + (less ? ` (${less} times less than Individual)` : '') + ` and Professional ${(0, _readingPlans.formatMb)(plans.professional)}` + (more ? ` (${more} times more than Individual)` : '') + '.';
}

/** Resolves userId from Zustand store (warm) or WatermelonDB (cold). */
async function getStoredUserId() {
  let userId = _userStore.useUserStore.getState().userId;
  if (!userId) {
    userId = await (0, _settingService.getSetting)('cached_user_id');
  }
  return userId;
}

/**
 * OFFERS extracted facts for the user to confirm. Writes NOTHING.
 *
 * This used to save every fact and fire topic generation before it returned, so
 * the "Topics I'll track" card was an undo, not a confirmation. That is how
 * "I'm interested in sporting football club" became the saved fact "Interested
 * in sporting a football club" — one inserted article decided that `sporting`
 * was a verb, and topic generation then had no entity to anchor to and fell back
 * to the user's city.
 *
 * Now it returns `pendingFacts` and stops. `commitFactChoices` (fact-commit.ts)
 * does the writing, once the user taps a reading on a FactChoiceCard.
 *
 * `factsSaved: 0` in the returned shape is LOAD-BEARING, not decoration.
 * `deriveThreadItems.deriveCard` falls back to reading this tool's INPUT when
 * `savedFacts` is absent, so without an explicit zero every staged turn would
 * render a "Saved to your persona" card listing candidate statements that were
 * never saved — a lie on the exact surface this change exists to make honest.
 */
async function handleSaveExtractedFacts(args) {
  const facts = args.extracted_user_information;
  if (!Array.isArray(facts) || facts.length === 0) {
    return {
      success: true,
      staged: true,
      factsSaved: 0,
      savedFacts: [],
      conflicts: [],
      groupResolutions: {},
      pendingFacts: []
    };
  }

  // Load existing facts for dedup — local LLMs often re-emit known facts, and a
  // reading that duplicates one is dropped from the CARD rather than offered and
  // then refused after the tap.
  const existingFacts = await (0, _factService.getFacts)();
  const existingStatements = existingFacts.map(f => (0, _factRules.normalizeStatement)(f.statement));

  // The accept/reject DECISIONS stay the harness's pure fact-rules; this handler
  // keeps the side effects, which are now logging and nothing else.
  const {
    groups,
    rejected
  } = (0, _factRules.filterFactChoiceGroups)(facts, existingStatements);
  for (const r of rejected) {
    if (r.reason === 'too-long') {
      _logger.default.warn('Rejected fact exceeding max length', {
        length: r.statement.length
      });
    } else if (r.reason === 'meta') {
      _logger.default.debug('Rejected meta-conversational fact', {
        length: r.statement.length
      });
    }
  }
  _logger.default.debug('[saveExtractedFacts] staged', {
    groups: groups.length,
    options: groups.map(g => g.options.length)
  });
  return {
    success: true,
    staged: true,
    factsSaved: 0,
    savedFacts: [],
    conflicts: [],
    // `groupResolutions` is a SCHEMA MARKER written at staging time, NOT "has
    // anyone committed yet". Its PRESENCE is what tells deriveThreadItems that
    // this blob is group-shaped, so both legacy readers (deriveCard's aggregate
    // fact-card and savedFactsWithIds) can be gated on its absence and a
    // pre-change persisted result keeps rendering exactly as it does today.
    // Writing it empty here rather than on first commit means the marker exists
    // for the whole pending window, including a turn nobody ever answers.
    groupResolutions: {},
    pendingFacts: groups.map((g, index) => ({
      index,
      // Stamped now so identity is decided by the staging side once, rather
      // than recomputed at every render from whatever survived validation.
      groupId: (0, _factChoiceResolution.factChoiceGroupId)(index, g.options),
      options: g.options,
      questionnaireAttribute: g.questionnaire?.attribute ?? null,
      // On the SPINE, so deriveThreadItems reads one structured field rather
      // than re-parsing the raw tool arguments. Carried only -- whether it is
      // HONOURED is decided at commit time against a confirmed choice.
      ...(g.replaces ? {
        replaces: g.replaces
      } : {}),
      ...(g.topicSkillId ? {
        topicSkillId: g.topicSkillId
      } : {})
    }))
  };
}

/**
 * Facts with an enqueue in flight right now. `hasPendingJob` reads the table
 * asynchronously, so two same-tick callers (a double-tapped Retry) would both
 * see "no job" and enqueue two. Synchronous claim, released once the enqueue
 * settles; after that the job row itself is the dedupe.
 */
const enqueuingTopicGen = new Set();
function triggerTopicGeneration(savedFactEntries) {
  void startTopicGeneration(savedFactEntries);
}

/**
 * ONE QUEUED JOB PER FACT, cloud or on-device. Every run is ISOLATED:
 * the handler sees this fact alone, and combination topics come only from the
 * deferred pass. The cloud path used to make one inline batch call carrying the
 * other facts and a location line from another fact; that is retired. A queued
 * job survives an app kill and `InferenceQueue.start()` recovers it.
 *
 * Resolves once the jobs are enqueued, not when generation is done: the cards
 * observe `topics_status`. Never rejects.
 */
async function startTopicGeneration(savedFactEntries) {
  if (savedFactEntries.length === 0) return;
  const useCloud = _meraProtocolStore.useMeraProtocolStore.getState().processingMode === _graphqlTypes.ProcessingMode.Cloud;
  await Promise.all(savedFactEntries.map(async entry => {
    if (enqueuingTopicGen.has(entry.id)) return;
    enqueuingTopicGen.add(entry.id);
    try {
      if (await (0, _inferenceJobService.hasPendingJob)('topic_gen', 'factId', entry.id)) return;
      await (0, _inferenceJobService.enqueueJob)('topic_gen', {
        factId: entry.id,
        factStatement: entry.statement,
        useCloud,
        ...(entry.skillId ? {
          skillId: entry.skillId
        } : {})
        // Deliberately NO excludeTopics: the handler reads the live lists at
        // RUN time. A snapshot here is durable and stale by the time it runs.
      });
      _InferenceQueue.inferenceQueue.notify();
    } catch (err) {
      _logger.default.warn('Failed to enqueue topic gen', {
        factId: entry.id,
        error: String(err)
      });
    } finally {
      enqueuingTopicGen.delete(entry.id);
    }
  }));
}

/** Read one fact's current metadata (empty object if it can't be read). */
async function readFactMetadata(factId) {
  const facts = await (0, _factService.getFacts)();
  return facts.find(f => f.id === factId)?.metadata ?? {};
}

/** Drops the stored `topicGenError` so the fact leaves the failed state. */
async function clearTopicGenError(factId) {
  const metadata = await readFactMetadata(factId);
  if (!metadata.topicGenError) return;
  const {
    topicGenError: _dropped,
    ...rest
  } = metadata;
  await (0, _factService.updateFact)(factId, {
    metadata: rest
  });
  _floatingChatStore.useFloatingChatStore.getState().notifyFactMutation();
}

/**
 * User-initiated retry of topic generation for ONE fact. Clears the recorded
 * error, re-stamps 'pending', then enqueues through `startTopicGeneration`,
 * whose synchronous claim makes a double tap one job. Never rejects.
 */
async function retryTopicGenerationLocal(factId, factStatement, skillId) {
  try {
    await clearTopicGenError(factId);
    // Back to 'pending' for the duration of the run. Clearing the marker alone
    // left the column on 'error', so the card and the profile row kept reading
    // failed while the retry was actually in flight.
    await (0, _topicGenerationStatusService.beginTopicGeneration)([factId]);
  } catch (err) {
    _logger.default.warn('[topicGen] Failed to clear topicGenError before retry', {
      factId,
      error: String(err)
    });
  }
  await startTopicGeneration([{
    id: factId,
    statement: factStatement,
    skillId
  }]);
}
const retryTopicGeneration = exports.retryTopicGeneration = (0, _command.command)('retryTopicGeneration', retryTopicGenerationLocal);

/** Updates user language config immediately on the server (settings, not PII). */
async function handleUpdateUserConfig(args) {
  const languageCodes = args.language_codes;
  if (!Array.isArray(languageCodes)) {
    return {
      success: true,
      message: 'No config fields provided'
    };
  }
  const config = {
    language_codes: languageCodes
  };

  // Immediate fire-and-forget server update
  const userId = await getStoredUserId();
  if (userId) {
    _accountService.AccountService.updateUserConfig(userId, config).catch(err => _logger.default.warn('[updateUserConfig] Server update failed', {
      error: String(err)
    }));
  } else {
    _logger.default.warn('[updateUserConfig] No userId available — skipping server update');
  }
  return {
    success: true,
    language_codes: config.language_codes
  };
}

/**
 * Deletes facts from local DB by their local IDs.
 * Supports fallback matching by statement text — the small on-device LLM
 * sometimes provides the fact text instead of the UUID from [brackets].
 */
async function handleDeleteUserFacts(args) {
  const factIds = args.fact_ids;
  if (!Array.isArray(factIds) || factIds.length === 0) {
    return {
      error: 'fact_ids must be a non-empty array'
    };
  }

  // Resolve all facts to delete (by ID, attribute key, or statement text)
  const allFacts = await (0, _factService.getFacts)();
  const factsByIdMap = new Map(allFacts.map(f => [f.id, f]));

  /**
   * ALL facts sharing a key, not the last one to claim it.
   *
   * This used to be `new Map(allFacts.map(...))`, which is LAST-WINS, and the
   * attribute lookup ran BEFORE the id lookup. A persona holding two
   * location-ish facts therefore had one of them silently unreachable, and a
   * delete naming that attribute removed whichever sat last in `getFacts()`
   * order -- newest-first, so the OLDEST match. That is how "Expat from India
   * living in Nieuw-West, Amsterdam" vanished while the user was replacing
   * their residence: the origin fact was the oldest location-ish match and
   * absorbed a delete aimed at the residence.
   */
  const groupBy = key => {
    const m = new Map();
    for (const f of allFacts) {
      const k = key(f);
      if (!k) continue;
      const bucket = m.get(k);
      if (bucket) bucket.push(f);else m.set(k, [f]);
    }
    return m;
  };
  const byAttr = groupBy(f => f.questionnaireAttribute?.toLowerCase().trim() ?? null);
  const byText = groupBy(f => f.statement.toLowerCase().trim());
  const factsToDelete = [];
  const seenIds = new Set();
  const ambiguous = [];
  for (const rawId of factIds) {
    const trimmed = rawId.trim().replace(/^\[|\]$/g, '');

    // ID FIRST. An id names exactly one fact; an attribute or a statement may
    // name several, and resolving those before the unambiguous handle is what
    // let a precise request be answered imprecisely.
    const byId = factsByIdMap.get(trimmed);
    const matches = byId ? [byId] : byAttr.get(trimmed.toLowerCase()) ?? byText.get(trimmed.toLowerCase()) ?? [];
    if (matches.length === 0) {
      // Lengths only: a warning is a Sentry breadcrumb in production.
      _logger.default.warn('[deleteUserFacts] Fact not found', {
        inputLength: trimmed.length
      });
      continue;
    }
    if (matches.length > 1) {
      // REFUSED, not guessed. Deleting a fact is irreversible and cascades to
      // its topics, so an ambiguous handle is answered with the candidates and
      // their ids rather than with a coin flip.
      ambiguous.push({
        input: trimmed,
        candidates: matches.map(f => ({
          id: f.id,
          statement: f.statement
        }))
      });
      _logger.default.warn('[deleteUserFacts] ambiguous handle, refusing', {
        inputLength: trimmed.length,
        count: matches.length
      });
      continue;
    }
    const fact = matches[0];
    if (!seenIds.has(fact.id)) {
      seenIds.add(fact.id);
      factsToDelete.push(fact);
    }
  }
  if (ambiguous.length > 0 && factsToDelete.length === 0) {
    return {
      error: 'ambiguous fact reference, pass an exact fact id',
      ambiguous,
      deletedCount: 0,
      deletedStatements: []
    };
  }
  if (factsToDelete.length === 0) {
    return {
      success: true,
      deletedCount: 0,
      deletedStatements: []
    };
  }

  // Snapshot statements before deletion so fact cards can render what was removed.
  const deletedStatements = factsToDelete.map(fact => fact.statement);
  let deletedCount = 0;
  for (const fact of factsToDelete) {
    await (0, _factService.deleteFact)(fact.id);
    deletedCount++;
  }
  _floatingChatStore.useFloatingChatStore.getState().notifyFactMutation();
  return {
    success: true,
    deletedCount,
    deletedStatements
  };
}

/**
 * Issues a server-authoritative LLM warning. The server increments
 * llmWarningCount and blocks the user at count >= 3. On success we sync the
 * returned persona into the user store + WatermelonDB so the local cache (and
 * the config-panel banner) stay authoritative across restarts.
 *
 * Fails OPEN: a network hiccup returns blocked:false so a transient error never
 * wrongly locks a user out of the chat.
 */
async function handleIssueWarning(args) {
  const reason = args.reason ?? 'No reason provided';
  const userId = await getStoredUserId();
  if (!userId) {
    // Never the reason: the model writes it from the person's chat.
    _logger.default.warn('[issueWarning] No userId available — failing open');
    return {
      blocked: false,
      warningCount: 0,
      message: `Warning issued: ${reason}`
    };
  }
  try {
    const persona = await _accountService.AccountService.issueLlmWarning(userId, reason);

    // Sync the authoritative persona into the reactive store (config-panel
    // banner updates live) and persist to WatermelonDB (survives restart).
    _userStore.useUserStore.getState().setUserPersona(persona);
    _logger.default.warn('[issueWarning] Warning issued', {
      warningCount: persona.llmWarningCount,
      blocked: persona.blockedByLlm
    });
    if (persona.blockedByLlm) {
      return {
        blocked: true,
        warningCount: persona.llmWarningCount,
        // The model reads `message` (English); the banner reads `blockedReason`,
        // the server's own text, and falls back to its translated key when empty.
        message: persona.blockedByLlmReason ?? 'User has been blocked due to repeated warnings.',
        blockedReason: persona.blockedByLlmReason ?? ''
      };
    }
    return {
      blocked: false,
      warningCount: persona.llmWarningCount,
      message: `Warning ${persona.llmWarningCount}/3 issued: ${reason}`
    };
  } catch (error) {
    // Fail open — never block a user because of a transient network error.
    _logger.default.captureException(error, {
      tags: {
        service: 'tool-handlers',
        method: 'handleIssueWarning'
      },
      extra: {
        userId
      }
    });
    return {
      blocked: false,
      warningCount: 0,
      message: `Warning issued: ${reason}`
    };
  }
}