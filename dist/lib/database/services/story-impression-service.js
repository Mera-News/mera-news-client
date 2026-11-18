"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.clearAllImpressions = clearAllImpressions;
exports.deleteOlderThan = deleteOlderThan;
exports.getAll = getAll;
exports.getOpenedSeenBreakdown = getOpenedSeenBreakdown;
exports.getOpenedSeenSet = getOpenedSeenSet;
exports.getOpenedTitleNorms = getOpenedTitleNorms;
exports.recordOpen = recordOpen;
var _watermelondb = require("@nozbe/watermelondb");
var _index = _interopRequireDefault(require("../index"));
var _logger = _interopRequireDefault(require("../../logger"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Story-Impression Service — WatermelonDB adapter for persona-v3
// `story_impressions` seen-state. Presentation/dedup ONLY: impressions never
// mutate topics/facts/locations. One row per article_id, upserted;
// `opened` upgrades in place and never downgrades. TTL 30d via
// `deleteOlderThan` (data-cleanup-task).
//
// OPENS-ONLY (read = tapped): only `recordOpen` writes rows now (each
// with opened=true); there is no view/impression write path. The seen readers
// are opens-only by construction — `getOpenedSeenSet` (Dashboard read-ticks +
// P_SEEN scoring) and `getOpenedTitleNorms` (title-Jaccard dedup fallback).
// The old view-inclusive `getSeenSet` / `recordImpression` (which fed the Feed
// tab's viewed-elimination) were removed with that machinery; any legacy
// opened=false rows still on-device are inert and TTL out within 30d.

const impressionsCollection = _index.default.get('story_impressions');
const DAY_MS = 24 * 60 * 60 * 1000;
async function upsertImpression(input, opened) {
  const articleId = (input.articleId ?? '').trim();
  if (!articleId) return;
  try {
    await _index.default.write(async () => {
      // Query inside the write so check-then-mutate is atomic (WMDB
      // serializes writes — same pattern as setting-service).
      const existing = await impressionsCollection.query(_watermelondb.Q.where('article_id', articleId)).fetch();
      const now = new Date();
      if (existing.length > 0) {
        await existing[0].update(r => {
          r.lastSeenAt = now;
          r.seenCount = (r.seenCount ?? 0) + 1;
          if (opened) r.opened = true;
          // stable_cluster_id / title_norm are snapshotted at first impression;
          // backfill only if they were unknown then.
          if (r.stableClusterId == null && input.stableClusterId) {
            r.stableClusterId = input.stableClusterId;
          }
          if (r.titleNorm == null && input.titleNorm) {
            r.titleNorm = input.titleNorm;
          }
        });
      } else {
        await impressionsCollection.create(r => {
          r.articleId = articleId;
          r.stableClusterId = input.stableClusterId ?? null;
          r.suggestionId = input.suggestionId ?? null;
          r.titleNorm = input.titleNorm ?? null;
          r.surface = input.surface;
          r.opened = opened;
          r.firstSeenAt = now;
          r.lastSeenAt = now;
          r.seenCount = 1;
        });
      }
    });
  } catch (error) {
    _logger.default.captureException(error, {
      tags: {
        service: 'story-impression',
        method: opened ? 'recordOpen' : 'recordImpression'
      }
    });
  }
}

/** Records an open/read — upgrades `opened` in place. */
async function recordOpen(input) {
  await upsertImpression(input, true);
}

/** All impressions (dedup/seen-set builds). */
async function getAll() {
  return impressionsCollection.query().fetch();
}

/**
 * OPENS-ONLY seen set (owner decision): a story
 * counts as "seen" ONLY when it was explicitly OPENED/read (`opened=true`), NEVER
 * on a mere impression. This one set feeds BOTH:
 *   (a) swipe-deck exclusion — the deck drops any suggestion whose article_id OR
 *       stable_cluster_id is in here (the deck never drains from scrolling); and
 *   (b) the P_SEEN demotion — passed to `PersonaScoringContext.seenStoryIds`.
 * Both surfaces are opens-only by construction: there is no impression-keyed
 * path, so tab-1 scrolling can only demote (via P_SEEN if the article is later
 * opened) — it can never exclude a story from the deck.
 *
 * OPENS-ONLY consumers: Dashboard read-ticks + P_SEEN scoring. (The Feed tab no
 * longer excludes on views — read = tapped only — so there is no
 * view-inclusive seen set anymore.)
 *
 * Returns article_ids ∪ non-null stable_cluster_ids of opened rows. The
 * `Q.where('opened', true)` filter keeps the set opens-only.
 */
async function getOpenedSeenSet() {
  const {
    articleIds,
    clusterIds
  } = await getOpenedSeenBreakdown();
  return new Set([...articleIds, ...clusterIds]);
}

/** Age buckets on `first_seen_at`, exclusive — they partition `rowCount`. */

/**
 * The opened set, split by AXIS. `getOpenedSeenSet` merges the two, and once
 * merged they are indistinguishable — but the two behave very differently:
 * an article id identifies one story the user read, whereas a `stableClusterId`
 * identifies an ONGOING story and keeps matching brand-new articles in it for
 * the full 30-day impression TTL.
 *
 * The Feed's ingest gate deliberately uses `articleIds` only; the union still
 * feeds the Dashboard's read-ticks and the P_SEEN scoring demotion. The funnel
 * diagnostic uses the split + age buckets to show how much the cluster axis
 * would suppress.
 *
 * `getOpenedSeenSet` is a thin wrapper over this so the union can never drift
 * from the breakdown.
 */
async function getOpenedSeenBreakdown(nowMs = Date.now()) {
  const rows = await impressionsCollection.query(_watermelondb.Q.where('opened', true)).fetch();
  const articleIds = new Set();
  const clusterIds = new Set();
  const ageBuckets = {
    le24h: 0,
    d1to7: 0,
    d7to30: 0
  };
  let rowCount = 0;
  let oldestFirstSeenAtMs = null;
  let newestLastSeenAtMs = null;
  for (const r of rows) {
    rowCount++;
    if (r.articleId) articleIds.add(r.articleId);
    if (r.stableClusterId) clusterIds.add(r.stableClusterId);
    const first = r.firstSeenAt.getTime();
    oldestFirstSeenAtMs = oldestFirstSeenAtMs === null ? first : Math.min(oldestFirstSeenAtMs, first);
    const ageMs = nowMs - first;
    if (ageMs <= DAY_MS) ageBuckets.le24h++;else if (ageMs <= 7 * DAY_MS) ageBuckets.d1to7++;else ageBuckets.d7to30++;
    const last = r.lastSeenAt.getTime();
    newestLastSeenAtMs = newestLastSeenAtMs === null ? last : Math.max(newestLastSeenAtMs, last);
  }
  return {
    articleIds,
    clusterIds,
    stats: {
      rowCount,
      articleIdCount: articleIds.size,
      clusterIdCount: clusterIds.size,
      unionSize: new Set([...articleIds, ...clusterIds]).size,
      oldestFirstSeenAtMs,
      newestLastSeenAtMs,
      ageBuckets
    }
  };
}

/**
 * Snapshotted normalized titles of OPENED rows only — the title-Jaccard dedup
 * fallback for when a fresh suggestion has neither a matching
 * article_id nor a stable_cluster_id in `getOpenedSeenSet()`. The store compares
 * a candidate's normalized title against these via `titleJaccard ≥
 * TITLE_JACCARD_PROPAGATION_THRESHOLD` (0.55); fail-open (no match ⇒ not seen).
 * Opens-only for parity with `getOpenedSeenSet`.
 */
async function getOpenedTitleNorms() {
  const rows = await impressionsCollection.query(_watermelondb.Q.where('opened', true)).fetch();
  const out = [];
  for (const r of rows) {
    const t = (r.titleNorm ?? '').trim();
    if (t) out.push(t);
  }
  return out;
}

/** Clear reading history: every impression goes. A story that matched before
 *  can then match again, because this table is what remembers an open. */
async function clearAllImpressions() {
  const rows = await impressionsCollection.query().fetch();
  if (rows.length === 0) return;
  await _index.default.write(async () => {
    await _index.default.batch(rows.map(r => r.prepareDestroyPermanently()));
  });
}

/** Deletes impressions first seen before the cutoff. Returns deleted count. */
async function deleteOlderThan(cutoffMs) {
  const old = await impressionsCollection.query(_watermelondb.Q.where('first_seen_at', _watermelondb.Q.lt(cutoffMs))).fetch();
  if (old.length === 0) return 0;
  await _index.default.write(async () => {
    await _index.default.batch(old.map(r => r.prepareDestroyPermanently()));
  });
  return old.length;
}