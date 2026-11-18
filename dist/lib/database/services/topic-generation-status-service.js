"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.TOPICS_UNREADABLE_RUNS = exports.TOPICS_SETTLED = exports.TOPICS_RETRY_AT = exports.TOPICS_KEEP = exports.TOPICS_FROM_CHAT = exports.TOPICS_EMPTY_SINCE = exports.TOPICS_EMPTY_RUNS = exports.TOPICS_ASK_REMOVAL = exports.SECOND_RETRY_GAP_MS = exports.MAX_UNREADABLE_RUNS = exports.LEGACY_EMPTY_ERROR = exports.FIRST_RETRY_GAP_MS = void 0;
exports.beginTopicGeneration = beginTopicGeneration;
exports.completeTopicGeneration = completeTopicGeneration;
exports.failTopicGeneration = failTopicGeneration;
exports.markTopicGenerationSettled = markTopicGenerationSettled;
exports.noteUnreadableLadder = noteUnreadableLadder;
exports.restartTopicClocks = restartTopicClocks;
exports.settleEmptyTopicGeneration = settleEmptyTopicGeneration;
var _index = _interopRequireDefault(require("../index"));
var _logger = _interopRequireDefault(require("../../logger"));
var _topicService = require("./topic-service");
var _config = require("../../news-harness/core/config");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// The three verbs that move `facts.topics_status`.
//
// A status is never written on its own: each verb moves it as part of the
// operation that justifies it, so the column and the `topics` table cannot
// drift apart through a caller forgetting a step. There is deliberately NO
// exported bare setter.
//
// Its own file rather than an addition to fact-service or topic-service:
// fact-service already lazy-`require`s topic-service, so a static import back
// the other way would be a module cycle held together by that require. This
// module imports both collections directly.

const factsCollection = _index.default.get('facts');

/** The error a first-run empty stored before empties settled. A fact holding it
 *  exactly moves onto the lifecycle at the next sweep, clock starting then. */
const LEGACY_EMPTY_ERROR = exports.LEGACY_EMPTY_ERROR = 'Topic generation returned no usable topics';

/** A background ladder runs at least this long after the first run... */
const FIRST_RETRY_GAP_MS = exports.FIRST_RETRY_GAP_MS = 60 * 60 * 1000;
/** ...and the second at least this long after the first background ladder. */
const SECOND_RETRY_GAP_MS = exports.SECOND_RETRY_GAP_MS = 7 * 60 * 60 * 1000;

/** The empty-fact lifecycle, in `metadata_json`: no column, so no migration, and
 *  a restore clears these rather than carrying a stale clock. */
const TOPICS_EMPTY_SINCE = exports.TOPICS_EMPTY_SINCE = 'topics_empty_since';
const TOPICS_EMPTY_RUNS = exports.TOPICS_EMPTY_RUNS = 'topics_empty_runs';
const TOPICS_RETRY_AT = exports.TOPICS_RETRY_AT = 'topics_retry_at';
/** Background ladders the model answered with something unreadable. They end as
 *  errors, so they never count as runs, and nothing else would stop them. */
const TOPICS_UNREADABLE_RUNS = exports.TOPICS_UNREADABLE_RUNS = 'topics_unreadable_runs';
/** From here background retries stop until the person taps. */
const MAX_UNREADABLE_RUNS = exports.MAX_UNREADABLE_RUNS = 3;
/** A run finished for this fact, so "done with no topics" is a real answer and
 *  the orphan sweep must not read it as a job that died. */
const TOPICS_SETTLED = exports.TOPICS_SETTLED = 'topics_settled';
/** The fact was re-added after a removal: the sweep never removes it again. */
const TOPICS_KEEP = exports.TOPICS_KEEP = 'topics_keep';

/** Accepted in chat, and not as a replacement: a completed empty run may remove it. */
const TOPICS_FROM_CHAT = exports.TOPICS_FROM_CHAT = 'topics_from_chat';
/** Came back empty with the chat closed: waits for the reader's tap, no model call until then. */
const TOPICS_ASK_REMOVAL = exports.TOPICS_ASK_REMOVAL = 'topics_ask_removal';
/** Every metadata writer here merges INSIDE one write: `updateFact` replaces the
 *  whole object and a read before the write can lose a concurrent key. */
async function settleDone(factId, next, missing) {
  await _index.default.write(async () => {
    let record;
    try {
      record = await factsCollection.find(factId);
    } catch {
      _logger.default.warn(missing, {
        factId
      });
      return;
    }
    await record.update(f => {
      const now = new Date();
      const {
        topicGenError: _settled,
        ...rest
      } = f.metadata ?? {};
      f.topicsStatus = 'done';
      f.topicsUpdatedAt = now;
      f.updatedAt = now;
      f.metadata = next({
        ...rest,
        [TOPICS_SETTLED]: true
      });
    });
  });
}
function withoutLifecycle(metadata) {
  const {
    [TOPICS_EMPTY_SINCE]: _s,
    [TOPICS_EMPTY_RUNS]: _r,
    [TOPICS_RETRY_AT]: _a,
    [TOPICS_UNREADABLE_RUNS]: _u,
    [TOPICS_ASK_REMOVAL]: _t,
    ...rest
  } = metadata;
  return rest;
}

/**
 * Stamp 'pending' on every fact whose topic-generation job is being enqueued.
 *
 * ONE write for the whole set: the cloud path fans a single batch call out
 * over N facts, so N separate writes would be N transactions for one logical
 * event.
 */
async function beginTopicGeneration(factIds) {
  if (factIds.length === 0) return;
  const records = [];
  for (const id of factIds) {
    try {
      records.push(await factsCollection.find(id));
    } catch {
      // A fact deleted between enqueue and stamp is not an error worth
      // failing a batch over.
      _logger.default.warn('[topic-gen-status] begin: fact missing', {
        factId: id
      });
    }
  }
  if (records.length === 0) return;
  await _index.default.write(async () => {
    const now = new Date();
    await _index.default.batch(records.map(r => r.prepareUpdate(f => {
      f.topicsStatus = 'pending';
      f.topicsUpdatedAt = now;
    })));
  });
}

/**
 * Mint the run's topics, THEN stamp 'done'.
 *
 * Deliberately NOT one atomic batch. Making it atomic would mean forking
 * `createTopics` or refactoring it to expose prepare-builders, and its
 * resolve-or-create dedup floor is exactly the code you do not want a second
 * copy of — a duplicate topic row is independently retrieved and independently
 * billed on every feed sync. So reuse it, and pick the safe ordering, because
 * the two failure modes are not symmetric:
 *
 *   stamp first, mint throws  → 'done' with no topics, nothing ever retries.
 *                               Invisible and permanent.
 *   mint first, stamp throws  → topics exist and render, status still
 *                               'pending'. A cosmetic spinner, healed to
 *                               'done' by the rescue sweep at the next
 *                               foreground.
 *
 * `createTopics` also keeps `fact.metadata.topics` in step, so callers never
 * touch that second list themselves.
 */
async function completeTopicGeneration(factId, topicTexts) {
  const texts = topicTexts.map(t => t.trim()).filter(Boolean);

  // WEIGHT AND PROVENANCE ARE NOT OPTIONAL HERE, and omitting them is not a
  // cosmetic default. `createTopics` falls back to `weight: 0`, and
  // `buildRetrievalProfile` drops every topic whose effective weight is <= 0
  // before the feed query is built ("negatives / zero excluded -- never
  // sent"). A topic minted at 0 is therefore written, rendered on the Profile
  // with its own row, and never once asked about: the user sees a full topic
  // list where every line reads "0 articles".
  //
  // The sibling minting path, `syncLlmTopicsForFact`, passes these. This one
  // did not, and it
  // became reachable the moment the `topics/*` guidelines were wired to the
  // chat route, so every fact saved through a skill-guided run produced dead
  // topics.
  const minted = texts.length ? await (0, _topicService.createTopics)(texts.map(text => ({
    factId,
    text,
    weight: _config.DEFAULT_HARNESS_CONFIG.topicGen.llmTopicWeight,
    status: 'active',
    provenance: 'llm',
    highPriority: false
  }))) : [];

  // Anything added ends the empty lifecycle, whoever asked for the run.
  try {
    await settleDone(factId, withoutLifecycle, '[topic-gen-status] complete: fact missing at stamp');
  } catch (err) {
    _logger.default.warn('[topic-gen-status] complete: stamp failed', {
      factId,
      error: String(err)
    });
  }
  return minted;
}

/**
 * Stamp 'done' WITHOUT minting anything.
 *
 * For a path that already created the topics itself. `completeTopicGeneration`
 * mints, so calling it after a generator that has already written its rows
 * would duplicate them.
 *
 * THE BUG THIS EXISTS FOR: `fact-commit` stamps every accepted fact 'pending',
 * and only the queued skill-guided handler ever settled it. The batch cloud
 * generator minted topics and never touched the column, so its facts span
 * forever: chips visible in the chat card under a live "Finding topics"
 * spinner, and a profile row showing a spinner and no statement. Any path that
 * finishes generation must settle the status.
 */
async function markTopicGenerationSettled(factIds) {
  for (const factId of factIds) {
    await settleDone(factId, m => m, '[topic-gen-status] settle: fact missing at stamp');
  }
}

/**
 * The ladder finished and the fact has no topics of any kind: 'done', never
 * 'error', because an empty answer is an answer.
 *
 * A background ladder counts one completed run and sets the next slot. Anything
 * a person started (the first run, Retry, a tap on Generate more) restarts the
 * clock. `onlyIfClockRunning` is Generate more: nothing new on a fact outside
 * the lifecycle must not start one.
 */
async function settleEmptyTopicGeneration(factId, statement, opts = {}) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const {
    wasFactRemoved
  } = require("./persona-change-log-service");
  const reAdded = await wasFactRemoved(statement);
  await settleDone(factId, m => {
    const running = m[TOPICS_EMPTY_SINCE] != null;
    if (opts.onlyIfClockRunning && !running) return m;
    const now = Date.now();
    const keep = reAdded ? {
      [TOPICS_KEEP]: true
    } : {};
    if (opts.background && running) {
      const runs = (typeof m[TOPICS_EMPTY_RUNS] === 'number' ? m[TOPICS_EMPTY_RUNS] : 0) + 1;
      return {
        ...m,
        ...keep,
        [TOPICS_EMPTY_RUNS]: runs,
        [TOPICS_RETRY_AT]: now + SECOND_RETRY_GAP_MS
      };
    }
    return {
      ...withoutLifecycle(m),
      ...keep,
      [TOPICS_EMPTY_SINCE]: now,
      [TOPICS_EMPTY_RUNS]: 0,
      [TOPICS_RETRY_AT]: now + FIRST_RETRY_GAP_MS
    };
  }, '[topic-gen-status] empty: fact missing at stamp');
}

/** One more background ladder came back unreadable. Status and clock stay. */
async function noteUnreadableLadder(factId) {
  await _index.default.write(async () => {
    let record;
    try {
      record = await factsCollection.find(factId);
    } catch {
      return;
    }
    await record.update(f => {
      const metadata = f.metadata ?? {};
      const count = typeof metadata[TOPICS_UNREADABLE_RUNS] === 'number' ? metadata[TOPICS_UNREADABLE_RUNS] : 0;
      f.metadata = {
        ...metadata,
        [TOPICS_UNREADABLE_RUNS]: count + 1
      };
    });
  });
}

/**
 * After a restore: a backed-up clock says nothing about this phone, so every
 * running clock starts again. One write.
 */
async function restartTopicClocks() {
  const facts = await factsCollection.query().fetch();
  const running = facts.filter(f => f.metadata?.[TOPICS_EMPTY_SINCE] != null);
  if (running.length === 0) return;
  await _index.default.write(async () => {
    const now = Date.now();
    await _index.default.batch(running.map(record => record.prepareUpdate(f => {
      f.metadata = {
        ...withoutLifecycle(f.metadata),
        [TOPICS_EMPTY_SINCE]: now,
        [TOPICS_EMPTY_RUNS]: 0,
        [TOPICS_RETRY_AT]: now + FIRST_RETRY_GAP_MS
      };
    })));
  });
}

/**
 * Stamp 'error' AND write `metadata.topicGenError` in one write.
 *
 * Both, because three live components still read the legacy marker
 * (TopicPlanCard, tool-handlers' retry path) and they are not this area's to
 * change. Writing only one of the two would let the new column and the marker
 * disagree about the same run.
 */
async function failTopicGeneration(factId, message) {
  let record;
  try {
    record = await factsCollection.find(factId);
  } catch {
    _logger.default.warn('[topic-gen-status] fail: fact missing', {
      factId
    });
    return;
  }
  await _index.default.write(async () => {
    const now = new Date();
    await _index.default.batch([record.prepareUpdate(f => {
      f.topicsStatus = 'error';
      f.topicsUpdatedAt = now;
      // Spread the existing metadata: assigning `{ topicGenError }` alone
      // would drop `topics` and `topicsReviewedAt`.
      f.metadata = {
        ...(f.metadata ?? {}),
        topicGenError: [message]
      };
      f.updatedAt = now;
    })]);
  });
}