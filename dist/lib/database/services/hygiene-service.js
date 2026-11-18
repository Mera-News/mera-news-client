"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SWEEP_COOLDOWN_MS = exports.SANITY_RACE_MS = exports.MIN_PERSONA_AGE_MS = exports.MIN_FACTS_FOR_SWEEP = exports.HYGIENE_PENDING_PRESENTATION_CAP = void 0;
exports.acceptProposal = acceptProposal;
exports.addFollowInsteadProposal = addFollowInsteadProposal;
exports.addSanityProposals = addSanityProposals;
exports.followInsteadTakesFact = followInsteadTakesFact;
exports.getFollowInsteadState = getFollowInsteadState;
exports.getPendingCount = getPendingCount;
exports.getPendingProposals = getPendingProposals;
exports.rejectProposal = rejectProposal;
exports.runHygieneSweep = runHygieneSweep;
exports.subscribeHygieneChange = subscribeHygieneChange;
var _onDeviceGate = require("../../llm/on-device-gate");
var _logger = _interopRequireDefault(require("../../logger"));
var _toast = require("../../platform/toast");
var _trackActions = require("../../tracking/track-actions");
var _actionNames = require("../../news-harness/persona-management/action-names");
var _factHygiene = require("../../news-harness/persona-management/fact-hygiene");
var _factService = require("./fact-service");
var _topicService = require("./topic-service");
var _settingService = require("./setting-service");
var _personaActionExecutor = require("./persona-action-executor");
var sanityService = _interopRequireWildcard(require("./topic-sanity-service"));
var replacementService = _interopRequireWildcard(require("./topic-replacement-service"));
var changeLogService = _interopRequireWildcard(require("./persona-change-log-service"));
var cache;
function _interopRequireWildcard(e, t) { if (!t && e && e.__esModule) return e; var r, c, a = Object.defineProperty, n = { __proto__: null, default: e }; if (Object(e) !== e) return n; if (cache || "function" != typeof WeakMap || (cache = new WeakMap()), cache) { if (cache.has(e)) return cache.get(e); cache.set(e, n); } for (c in e) "default" !== c && {}.hasOwnProperty.call(e, c) && ((r = a && Object.getOwnPropertyDescriptor(e, c)) && (r.get || r.set) ? a(n, c, r) : n[c] = e[c]); return n; }
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Hygiene Service — RN adapter for the weekly persona fact-hygiene sweep
// Runs the pure analyzer (lib/news-harness/persona-management/
// fact-hygiene.ts) over live WatermelonDB persona rows, persists the current
// proposal set + the user's rejected-fingerprint memory via setting-service KV,
// and applies an accepted proposal's ops through the persona-action executor
// (invertible mutations) or fact-service (destructive deletes). Every applied
// cleanup lands a persona_change_log row so it shows up in the audit
// screen.
//
// No analysis math lives here — it is glue over the pure core + the existing
// per-collection services.

// ── KV keys + tunables ────────────────────────────────────────────────────

const PENDING_KEY = 'hygiene_pending_proposals';
const REJECTED_KEY = 'hygiene_rejected_fingerprints';
const LAST_SWEEP_KEY = 'hygiene_last_sweep_at';
/** Proposals produced but not yet SHOWN — see HYGIENE_PENDING_PRESENTATION_CAP. */
const BACKLOG_KEY = 'hygiene_proposal_backlog';

/**
 * Most proposals the review sheet ever holds at once.
 *
 * The one-time backfill can produce ~60 at a stroke, and a wall of 60 cards is a
 * dialog nobody reads — the user either bulk-accepts without looking or bounces.
 * Overflow is parked in a KV backlog and topped back up as each decision is
 * made, so the list stays short and self-refilling instead of being metered out
 * one sweep per week (which would take longer than the backlog it is draining).
 */
const HYGIENE_PENDING_PRESENTATION_CAP = exports.HYGIENE_PENDING_PRESENTATION_CAP = 10;

/** Don't sweep a persona with fewer facts than this — too little to clean. */
const MIN_FACTS_FOR_SWEEP = exports.MIN_FACTS_FOR_SWEEP = 10;
/** Don't sweep a persona younger than this (ms) — avoids firing on fresh
 *  installs / first-runs before the profile has settled. 7 days. */
const MIN_PERSONA_AGE_MS = exports.MIN_PERSONA_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Minimum gap between real analyses (ms). Slightly under the 7d task
 *  frequency so a due tick isn't rejected by rounding. 6 days. */
const SWEEP_COOLDOWN_MS = exports.SWEEP_COOLDOWN_MS = 6 * 24 * 60 * 60 * 1000;
/** Cap the remembered-rejections list so the KV blob can't grow unbounded. */
const MAX_REJECTED_FINGERPRINTS = 200;

/** Hard cap on how long the sweep waits for the LLM sanity audit before
 *  publishing without it. Sits under the task's 90s timeout, and the race NEVER
 *  rejects — a slow audit degrades to "no sanity proposals this week", never to
 *  a failed sweep or a retried (double-billed) call. */
const SANITY_RACE_MS = exports.SANITY_RACE_MS = 60_000;
/** Resolve `fn` normally, or `fallback` if it takes too long / throws. Never
 *  rejects — that property is what makes raising the task timeout safe. */
async function raceWithFallback(promise, ms, fallback) {
  let timer;
  try {
    return await Promise.race([promise.catch(() => fallback), new Promise(resolve => {
      timer = setTimeout(() => resolve(fallback), ms);
    })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── Change notifier (Profile row / review sheet refresh) ───────────────────

const listeners = new Set();

/** Subscribe to pending-proposal changes (sweep / accept / reject). Returns an
 *  unsubscribe fn. The Profile indicator row and review sheet use this to stay
 *  in sync without polling a reactive DB query. */
function subscribeHygieneChange(cb) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
function notifyChange() {
  for (const cb of listeners) {
    try {
      cb();
    } catch {
      /* listener errors are non-fatal */
    }
  }
}

// ── KV read/write helpers ──────────────────────────────────────────────────

function parseArray(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
async function readPending() {
  const rows = parseArray(await (0, _settingService.getSetting)(PENDING_KEY));
  // Defensive shape filter — drop anything that isn't a well-formed proposal.
  return rows.filter(p => p && typeof p.id === 'string' && Array.isArray(p.ops));
}
async function writePending(proposals) {
  await (0, _settingService.setSetting)(PENDING_KEY, JSON.stringify(proposals));
}
async function readBacklog() {
  return parseArray(await (0, _settingService.getSetting)(BACKLOG_KEY)).filter(p => p && typeof p.id === 'string' && Array.isArray(p.ops));
}
async function writeBacklog(proposals) {
  await (0, _settingService.setSetting)(BACKLOG_KEY, JSON.stringify(proposals));
}

/**
 * Split a freshly-analyzed proposal set into what is shown now and what waits.
 * Order is preserved, so the analyzer's deterministic kind-ordering decides what
 * the user sees first.
 */
async function publishWithCap(proposals) {
  await writePending(proposals.slice(0, HYGIENE_PENDING_PRESENTATION_CAP));
  await writeBacklog(proposals.slice(HYGIENE_PENDING_PRESENTATION_CAP));
}

/**
 * The queue the weekly sweep is about to publish, with the daily offers kept in
 * front. That sweep replaces pending and backlog, and a daily offer is not its
 * to drop: nothing would make it again for a day, or at all once dismissed facts
 * thin the list.
 */
async function withDailyOffers(proposals) {
  const [pending, backlog] = await Promise.all([readPending(), readBacklog()]);
  return [...[...pending, ...backlog].filter(p => p.kind === 'follow_instead'), ...proposals];
}

/**
 * After a decision removes a proposal, pull the next one forward immediately.
 * Immediate — not "next sweep" — because the backfill's whole point is clearing
 * a backlog fast; refilling weekly would drain 60 proposals slower than the four
 * weeks the one-time pass exists to beat.
 */
async function refillFromBacklog(remainingPending) {
  const room = HYGIENE_PENDING_PRESENTATION_CAP - remainingPending.length;
  if (room <= 0) {
    await writePending(remainingPending);
    return;
  }
  const backlog = await readBacklog();
  if (backlog.length === 0) {
    await writePending(remainingPending);
    return;
  }
  await writePending([...remainingPending, ...backlog.slice(0, room)]);
  await writeBacklog(backlog.slice(room));
}
async function readRejected() {
  return parseArray(await (0, _settingService.getSetting)(REJECTED_KEY));
}
async function writeRejected(fingerprints) {
  // Keep the most-recent tail if we ever exceed the cap.
  const capped = fingerprints.length > MAX_REJECTED_FINGERPRINTS ? fingerprints.slice(fingerprints.length - MAX_REJECTED_FINGERPRINTS) : fingerprints;
  await (0, _settingService.setSetting)(REJECTED_KEY, JSON.stringify(capped));
}

// ── Public getters ─────────────────────────────────────────────────────────

/**
 * Pending and backlog with every proposal whose fact is gone dropped, and the
 * drop persisted. A proposal is stored at sweep time; a fact deleted or merged
 * afterwards left it pending for good, as a card naming nothing whose Accept
 * acted on nothing. A proposal that names no fact is kept.
 */
async function readLive() {
  const [pending, backlog, facts] = await Promise.all([readPending(), readBacklog(), (0, _factService.getFacts)()]);
  const factIds = new Set(facts.map(f => f.id));
  const alive = p => (p.targetFactIds ?? []).every(id => factIds.has(id));
  const live = {
    pending: pending.filter(alive),
    backlog: backlog.filter(alive)
  };
  if (live.pending.length !== pending.length || live.backlog.length !== backlog.length) {
    await publishWithCap([...live.pending, ...live.backlog]);
    return readLive();
  }
  return live;
}
async function getPendingProposals() {
  return (await readLive()).pending;
}

/**
 * Every proposal still waiting for a decision: the visible window plus the
 * parked backlog. The sheet shows at most HYGIENE_PENDING_PRESENTATION_CAP at a
 * time, but the user is told the real number of outstanding cleanups rather
 * than the paging window. Cheap (two settings reads), so the Profile row polls
 * it on focus and on change. THE count for anything that tells the user how many cleanups
 * wait (the notification at all three notify sites, the Profile row), so they
 * can never disagree with each other or with the review queue. Never the
 * number a single call just added: that was the "bell says 1, review lists 2"
 * bug.
 */
async function getPendingCount() {
  const {
    pending,
    backlog
  } = await readLive();
  return pending.length + backlog.length;
}

// ── Sweep ──────────────────────────────────────────────────────────────────

/**
 * Analyze live persona data → store proposals → fire ONE hygiene notification
 * when there is anything to review. Guarded so it is safe to call on every
 * scheduler tick: skips when on cooldown, when the persona is too small, or too
 * young. Pass `force: true` (e.g. a debug trigger) to bypass the cooldown.
 */
async function runHygieneSweep(opts) {
  const now = opts?.now ?? Date.now();

  // Cooldown guard (KV stamp) — independent of the scheduler's own bookkeeping.
  if (!opts?.force) {
    const last = Number(await (0, _settingService.getSetting)(LAST_SWEEP_KEY));
    if (Number.isFinite(last) && last > 0 && now - last < SWEEP_COOLDOWN_MS) {
      return {
        ran: false,
        reason: 'cooldown',
        proposalCount: await getPendingCount()
      };
    }
  }
  const [facts, sectionSnapshots, topics] = await Promise.all([(0, _factService.getFacts)(), (0, _factService.getFactSectionSnapshots)(), (0, _topicService.getAllTopicSnapshots)()]);

  // Kick the LLM sanity audit off BEFORE the size/age gates. Those gates exist
  // for the four *cleanup* kinds ("too little to clean", "let the profile
  // settle") and neither rationale transfers: contamination is present from the
  // very first generation, is worse the more facts there are, and auditing a
  // young persona carries no false-positive risk. Left behind the gates, a
  // 9-fact persona would never be cleaned and a new user would wait 7 days to
  // see the topics they are complaining about today.
  const sanityPromise = raceWithFallback(sanityService.runSanityAudit({
    facts: facts.map(f => ({
      id: f.id,
      statement: f.statement
    }))
  }), SANITY_RACE_MS,
  // `skipped: false` explicitly. A TIMEOUT is not a skip — the audit was
  // attempted and may well have been billed; only a missing credential means
  // it never ran. Reading a timeout as a skip would withhold the cooldown
  // stamp and re-issue the call on the next sweep.
  {
    incoherentFacts: [],
    audited: 0,
    skipped: false,
    exhausted: false,
    nextCursorMs: null,
    stallCount: null
  });
  if (facts.length < MIN_FACTS_FOR_SWEEP) {
    return publishSanityOnly(await sanityPromise, facts, topics, now, 'too_few_facts');
  }

  // Persona age = time since the earliest fact was created.
  const createdTimes = sectionSnapshots.map(s => s.createdAtMs).filter(ms => ms > 0);
  const earliest = createdTimes.length > 0 ? Math.min(...createdTimes) : now;
  if (now - earliest < MIN_PERSONA_AGE_MS) {
    return publishSanityOnly(await sanityPromise, facts, topics, now, 'persona_too_young');
  }

  // Join fact weight (from section snapshots) onto the analyzer input.
  const weightById = new Map(sectionSnapshots.map(s => [s.id, s.weight]));
  const createdById = new Map(sectionSnapshots.map(s => [s.id, s.createdAtMs]));
  const factInputs = facts.map(f => ({
    id: f.id,
    statement: f.statement,
    weight: weightById.get(f.id) ?? null,
    createdAtMs: createdById.get(f.id) ?? 0,
    // Tells location_conflict which facts state where the user lives.
    questionnaireAttribute: f.questionnaireAttribute
  }));
  const rejected = await readRejected();
  // Wait for the audit here — its verdicts must reach the SAME pending set and
  // the SAME single notification (persona-hygiene-task documents "fires ONE
  // hygiene notification"). Bounded and non-rejecting, so the worst case is
  // zero sanity proposals rather than a failed sweep.
  const sanity = await sanityPromise;
  const input = {
    facts: factInputs,
    topics,
    now,
    rejectedFingerprints: rejected,
    incoherentFacts: sanity.incoherentFacts
  };
  const proposals = (0, _factHygiene.analyzeHygiene)(input);
  await publishWithCap(await withDailyOffers(proposals));
  await commitAuditCursor(sanity);
  await stampSweep(now, sanity.skipped);
  notifyChange();
  if (proposals.length > 0) {
    void _toast.toastManager.showNotifiedToast({
      type: 'hygiene',
      source: 'hygiene',
      title: 'hygiene.notificationTitle',
      body: 'hygiene.notificationBody',
      icon: 'cleaning-services',
      context: {
        count: await getPendingCount()
      },
      actions: [{
        id: 'review-hygiene',
        labelKey: 'hygiene.reviewChip'
      }]
    });
  }
  return {
    ran: true,
    proposalCount: proposals.length,
    sanitySkipped: sanity.skipped
  };
}

/**
 * Move the sanity audit cursor past what this run judged. Only after the
 * verdicts are stored: a cursor moved first loses them if the write fails.
 */
async function commitAuditCursor(sanity) {
  await sanityService.commitSanityCursor(sanity);
}

/**
 * Stamp the KV cooldown, unless the sanity audit never ran for want of a
 * credential. Every path that made a real sweep attempt stamps — including the
 * two size/age early returns, which previously stamped nothing at all and so
 * re-issued a billed audit on every scheduled run for a small or young persona.
 */
async function stampSweep(now, sanitySkipped) {
  if (sanitySkipped) return;
  await (0, _settingService.setSetting)(LAST_SWEEP_KEY, String(now));
}

/**
 * Publish sanity proposals when the sweep bailed on the size/age gate.
 *
 * The four cleanup kinds are correctly withheld for a small or young persona,
 * but the sanity verdicts are not — so instead of returning `proposalCount: 0`
 * blindly, run the analyzer with an EMPTY fact list (which suppresses every
 * fact-derived kind) and publish whatever the audit found. `ran` stays false and
 * the reason is preserved, so the caller's bookkeeping is unchanged.
 */
async function publishSanityOnly(sanity, facts, topics, now, reason) {
  const incoherentFacts = sanity.incoherentFacts ?? [];
  // NOTE ON ORDER: every stamp below comes AFTER the work it is recording, and
  // the publishing exit stamps after `publishWithCap`. Stamping up front would
  // arm the six-day cooldown even if the publish then threw — the retry would
  // read `reason: 'cooldown'` and the user would lose the proposals for a week.
  // The full-sweep path is ordered the same way for the same reason.
  if (incoherentFacts.length === 0) {
    await commitAuditCursor(sanity);
    await stampSweep(now, sanity.skipped);
    return {
      ran: false,
      reason,
      proposalCount: await getPendingCount(),
      sanitySkipped: sanity.skipped
    };
  }
  const proposals = (0, _factHygiene.analyzeHygiene)({
    // Facts ARE supplied (the summary needs their statements) but every
    // fact-derived kind needs >= 2 facts or a weight/staleness signal; the
    // incoherent kind is the only one these inputs can produce.
    facts: facts.map(f => ({
      id: f.id,
      statement: f.statement,
      weight: null,
      createdAtMs: now
    })),
    topics,
    now,
    rejectedFingerprints: await readRejected(),
    incoherentFacts
  }).filter(p => p.kind === 'incoherent_topics');
  if (proposals.length === 0) {
    await commitAuditCursor(sanity);
    await stampSweep(now, sanity.skipped);
    return {
      ran: false,
      reason,
      proposalCount: await getPendingCount(),
      sanitySkipped: sanity.skipped
    };
  }
  await publishWithCap(await withDailyOffers(proposals));
  await commitAuditCursor(sanity);
  await stampSweep(now, sanity.skipped);
  notifyChange();
  void _toast.toastManager.showNotifiedToast({
    type: 'hygiene',
    source: 'hygiene',
    title: 'hygiene.notificationTitle',
    body: 'hygiene.notificationBody',
    icon: 'cleaning-services',
    context: {
      count: await getPendingCount()
    },
    actions: [{
      id: 'review-hygiene',
      labelKey: 'hygiene.reviewChip'
    }]
  });
  return {
    ran: false,
    reason,
    proposalCount: proposals.length,
    sanitySkipped: sanity.skipped
  };
}

/**
 * Merge sanity verdicts into the review queue WITHOUT running a full sweep.
 *
 * The one-time backfill calls this once per chunk as it walks the corpus, so it
 * must be additive and idempotent: proposals already pending or already parked
 * in the backlog are skipped by fingerprint, and the presentation cap still
 * decides how many are visible. A corpus-wide pass therefore cannot surface a
 * wall of cards — it fills the window, parks the rest, and the window refills as
 * the user decides.
 *
 * Fires the notification only when asked (the backfill fires once, on its first
 * non-empty chunk, rather than once per chunk).
 */
async function addSanityProposals(incoherentFacts, opts) {
  if (incoherentFacts.length === 0) return 0;
  const now = opts?.now ?? Date.now();
  const [facts, topics, rejected, pending, backlog] = await Promise.all([(0, _factService.getFacts)(), (0, _topicService.getAllTopicSnapshots)(), readRejected(), readPending(), readBacklog()]);
  const fresh = (0, _factHygiene.analyzeHygiene)({
    facts: facts.map(f => ({
      id: f.id,
      statement: f.statement,
      weight: null,
      createdAtMs: now
    })),
    topics,
    now,
    rejectedFingerprints: rejected,
    incoherentFacts
  }).filter(p => p.kind === 'incoherent_topics');
  const known = new Set([...pending, ...backlog].map(p => p.id));
  const added = fresh.filter(p => !known.has(p.id));
  if (added.length === 0) return 0;
  await publishWithCap([...pending, ...backlog, ...added]);
  notifyChange();
  if (opts?.notify) {
    void _toast.toastManager.showNotifiedToast({
      type: 'hygiene',
      source: 'hygiene',
      title: 'hygiene.notificationTitle',
      body: 'hygiene.notificationBody',
      icon: 'cleaning-services',
      context: {
        count: await getPendingCount()
      },
      actions: [{
        id: 'review-hygiene',
        labelKey: 'hygiene.reviewChip'
      }]
    });
  }
  return added.length;
}

// ── Follow instead (the daily offer) ───────────────────────────────────────

/** What the daily sweep needs before it spends a call. */
async function getFollowInsteadState() {
  const [{
    pending,
    backlog
  }, rejected] = await Promise.all([readLive(), readRejected()]);
  return {
    rejected,
    offerWaiting: [...pending, ...backlog].some(p => p.kind === 'follow_instead')
  };
}

/**
 * Publish the day's offer. It goes first: a full queue must not park the one
 * proposal that gets a reader out of an empty Feed in the backlog.
 */
async function addFollowInsteadProposal(proposal) {
  const {
    pending,
    backlog
  } = await readLive();
  await publishWithCap([proposal, ...pending, ...backlog]);
  notifyChange();
  void _toast.toastManager.showNotifiedToast({
    type: 'hygiene',
    source: 'hygiene',
    title: 'hygiene.followInsteadNotificationTitle',
    body: 'hygiene.followInsteadNotificationBody',
    icon: 'cleaning-services',
    context: {
      count: await getPendingCount()
    },
    actions: [{
      id: 'review-hygiene',
      labelKey: 'hygiene.reviewChip'
    }]
  });
}

/** Whether accepting takes the fact too, which has no undo: always on the no-stake
 *  trigger, and on a flood when this was the fact's last active topic. Read live,
 *  because a reader can change their topics after the sweep. */
async function followInsteadTakesFact(proposal) {
  if ((0, _factHygiene.isNoStakeOffer)(proposal)) return true;
  return (await activeTopicsOf(proposal)).every(t => proposal.targetTopicIds.includes(t.id));
}
async function activeTopicsOf(proposal) {
  const topics = await (0, _topicService.getAllTopicSnapshots)();
  return topics.filter(t => t.status === 'active' && t.factId === proposal.targetFactIds[0]);
}

/** Delete a fact and its audit row. The statement is read first, because the
 *  audit row names it from the log once the fact is gone. */
async function deleteFactLogged(factId, proposal) {
  const statement = (await (0, _factService.getFacts)()).find(f => f.id === factId)?.statement;
  await (0, _factService.deleteFact)(factId);
  await changeLogService.append({
    actionType: _actionNames.ACTION_NAMES.HYGIENE_DELETE_FACT,
    action: {
      targetId: factId,
      ...(statement ? {
        statement
      } : {})
    },
    source: 'digest',
    summary: proposal.kind
  });
}

/**
 * Accept a follow_instead offer. Off the generic loop on purpose: that loop runs
 * every op whatever the one before it did, so a failed follow would still remove
 * the topic. Here nothing is removed until the follow landed, a failure anywhere
 * keeps the proposal, and a second tap finishes the job (`trackStoryWithProposal`
 * answers `already` and mints no second story). The sync runs last, so it reads
 * the set this accept left.
 */
async function applyFollowInsteadProposal(proposal) {
  const follow = proposal.ops.find(op => op.type === 'follow_story');
  if (follow?.type !== 'follow_story') return {
    applied: false,
    ok: false
  };
  const takesFact = await followInsteadTakesFact(proposal);
  // Read before the follow: the reader may have removed a topic since the sweep.
  const moving = (await activeTopicsOf(proposal)).filter(t => proposal.targetTopicIds.includes(t.id));
  const outcome = await (0, _trackActions.trackStoryWithProposal)(follow.subject, {
    label: follow.label,
    searchText: follow.searchText
  }, {
    syncFeed: false,
    requireTopic: true
  });
  if (outcome === 'skipped') return {
    applied: false,
    ok: false
  };
  if (takesFact) {
    await deleteFactLogged(proposal.targetFactIds[0], proposal);
  } else {
    for (const {
      id: topicId
    } of moving) {
      const res = await (0, _personaActionExecutor.applyPersonaAction)({
        action_type: _actionNames.ACTION_NAMES.RETIRE_TOPIC,
        topicId
      }, 'digest');
      if (!res.applied) return {
        applied: false,
        ok: false
      };
    }
  }
  const pending = await readPending();
  await refillFromBacklog(pending.filter(p => p.id !== proposal.id));
  notifyChange();
  void (0, _trackActions.syncFollowedStoryNow)();
  return {
    applied: true,
    ok: true
  };
}

// ── Accept / Reject ──────────────────────────────────────────────────────────

/**
 * Apply an `incoherent_topics` proposal as ONE unit.
 *
 * Handled off the generic op loop on purpose. The generic loop runs each op
 * independently — a mint through one writer, each retire through
 * applyPersonaAction's own write — which cannot give the atomicity this kind
 * needs. Here generation, minting and retiring are a single decision:
 *
 *   (a) generate first; ANY failure returns applied:false having changed
 *       nothing, and the proposal stays pending for another tap;
 *   (b) the mint and the retires land in ONE database.write/batch;
 *   (c) if replacements came back empty, the retire is withheld rather than
 *       leave the fact with zero active topics.
 *
 * The change-log rows are appended AFTER the write commits — an audit entry is
 * worth less than the invariant, so it must never be what forces the ordering.
 */
async function applyIncoherentTopicsProposal(proposal) {
  const genOp = proposal.ops.find(op => op.type === 'generate_replacements');
  if (!genOp || genOp.type !== 'generate_replacements') {
    return {
      applied: false,
      ok: false
    };
  }
  const retireIds = proposal.ops.filter(op => op.type === 'persona_action').map(op => op.action.topicId).filter(id => !!id);
  const outcome = await replacementService.generateAndReplace(genOp.factId, genOp.fillTo, retireIds);
  if (!outcome.ok) {
    _logger.default.warn('[hygiene] replacement generation failed — nothing retired', {
      proposalId: proposal.id,
      factId: genOp.factId
    });
    return {
      applied: false,
      ok: false
    };
  }
  for (const topicId of retireIds.slice(0, outcome.retired)) {
    await changeLogService.append({
      actionType: _actionNames.ACTION_NAMES.RETIRE_TOPIC,
      action: {
        targetId: topicId
      },
      source: 'digest',
      // Not shown: the audit screen renders the row from its action type.
      summary: proposal.kind
    }).catch(() => {
      /* audit only — never fails the applied change */
    });
  }
  const pending = await readPending();
  await refillFromBacklog(pending.filter(p => p.id !== proposal.id));
  notifyChange();

  // floorHeld ⇒ the fact would have gone dark, so the removal was withheld. The
  // proposal is still settled and not re-offered, quietly: no retry toast, and
  // `floorHeld` tells the screen to show no success toast either.
  return {
    applied: true,
    ok: true,
    ...(outcome.floorHeld ? {
      floorHeld: true
    } : {})
  };
}
/**
 * Apply a proposal's ops (executor for invertible persona actions; fact-service
 * for destructive deletes, each logged to persona_change_log with source
 * 'digest'), then remove it from the pending set. Never throws.
 */
async function acceptProposal(id) {
  const pending = await readPending();
  const proposal = pending.find(p => p.id === id);
  if (!proposal) return {
    applied: false,
    ok: false
  };

  // `incoherent_topics` is generate-then-retire and needs its ops applied as a
  // single atomic unit, which the generic per-op loop below cannot provide.
  if (proposal.kind === 'incoherent_topics') {
    // Its replacement topics come from one cloud call. On-device: change
    // nothing and keep the proposal for when the reader is back on the cloud.
    if (await (0, _onDeviceGate.isOnDeviceMode)()) return {
      applied: false,
      ok: false,
      needsCloud: true
    };
    try {
      return await applyIncoherentTopicsProposal(proposal);
    } catch (error) {
      _logger.default.captureException(error, {
        tags: {
          service: 'hygiene-service',
          method: 'acceptProposal.incoherent'
        }
      });
      return {
        applied: false,
        ok: false
      };
    }
  }
  if (proposal.kind === 'follow_instead') {
    try {
      return await applyFollowInsteadProposal(proposal);
    } catch (error) {
      _logger.default.captureException(error, {
        tags: {
          service: 'hygiene-service',
          method: 'acceptProposal.followInstead'
        }
      });
      return {
        applied: false,
        ok: false
      };
    }
  }
  let ok = true;
  for (const op of proposal.ops) {
    try {
      if (op.type === 'generate_replacements' || op.type === 'follow_story') {
        continue; // handled off this loop
      } else if (op.type === 'delete_fact') {
        await deleteFactLogged(op.factId, proposal);
      } else {
        // Structurally compatible with the executor's PersonaAction.
        const res = await (0, _personaActionExecutor.applyPersonaAction)(op.action, 'digest');
        if (!res.applied) ok = false;
      }
    } catch (error) {
      ok = false;
      _logger.default.captureException(error, {
        tags: {
          service: 'hygiene-service',
          method: 'acceptProposal',
          kind: proposal.kind
        }
      });
    }
  }
  await refillFromBacklog(pending.filter(p => p.id !== id));
  notifyChange();
  return {
    applied: true,
    ok
  };
}

/**
 * Remember a proposal's fingerprint so the next sweep never re-proposes it, and
 * drop it from the pending set. Never throws.
 */
async function rejectProposal(id) {
  const [pending, rejected] = await Promise.all([readPending(), readRejected()]);
  if (!rejected.includes(id)) {
    await writeRejected([...rejected, id]);
  }
  await refillFromBacklog(pending.filter(p => p.id !== id));
  notifyChange();
}