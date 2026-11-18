"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.MAX_MEMBER_SNAPSHOTS = exports.MAX_MEMBER_IDS = void 0;
exports.advanceSeenWatermark = advanceSeenWatermark;
exports.applyUpdates = applyUpdates;
exports.backfillSnapshotSource = backfillSnapshotSource;
exports.bindTrackedTopic = bindTrackedTopic;
exports.findActiveTrackedId = findActiveTrackedId;
exports.getActiveForTopicReconcile = getActiveForTopicReconcile;
exports.getLegacyTrackedForMigration = getLegacyTrackedForMigration;
exports.getTrackedStoryById = getTrackedStoryById;
exports.isTracked = isTracked;
exports.isTrackedStoryMember = isTrackedStoryMember;
exports.listTrackedMemberArticleIds = listTrackedMemberArticleIds;
exports.markSeen = markSeen;
exports.mergeMemberSnapshots = mergeMemberSnapshots;
exports.observeActive = observeActive;
exports.observeTracked = observeTracked;
exports.observeTrackedId = observeTrackedId;
exports.observeUnseenTotal = observeUnseenTotal;
exports.removeMemberSnapshot = removeMemberSnapshot;
exports.setLlmHeadline = setLlmHeadline;
exports.sortTrackedStories = sortTrackedStories;
exports.stampChecked = stampChecked;
exports.trackStory = trackStory;
exports.untrackStory = untrackStory;
var _watermelondb = require("@nozbe/watermelondb");
var _rxjs = require("rxjs");
var _index = _interopRequireDefault(require("../index"));
var _logger = _interopRequireDefault(require("../../logger"));
var _storyFoldKey = require("../../tracking/story-fold-key");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Tracked-Story Service — WatermelonDB adapter for `tracked_stories` (schema
// v39). Long-lived, user-owned "follow this story" state. Pure CRUD: this file
// owns creation/mutation only — the follow UI, reconcile poll, and headline
// enrichment call these. English-canonical (headline/title
// rendered downstream via TranslatableDynamic).

const collection = _index.default.get('tracked_stories');

/** Newest-first cap on a story's remembered member article ids, the reconcile's
 *  already-counted ledger. It must hold every member still on device (the 48-72h
 *  suggestion window): an id that falls off reads as new on the next sync and is
 *  counted again, which once ran a hot story's "N new" into the thousands at 30.
 *  shortcut: fixed ceiling, prune to ids still on device if a story ever exceeds it. */
const MAX_MEMBER_IDS = exports.MAX_MEMBER_IDS = 2000;

/** Newest-first (by pubDate) cap on a story's remembered member snapshots: the
 *  most a timeline can show. ~470 bytes each (measured), so ~1 MB of JSON at the
 *  cap, parsed whole whenever the row is read. */
const MAX_MEMBER_SNAPSHOTS = exports.MAX_MEMBER_SNAPSHOTS = 2000;

/**
 * Merge new member snapshots into an existing set: new snapshots win on id
 * collision, the result is sorted strictly newest-first by `pubDateMs`, and
 * capped at {@link MAX_MEMBER_SNAPSHOTS}. Pure — shared by seed + applyUpdates.
 */
function mergeMemberSnapshots(existing, incoming) {
  const byId = new Map();
  for (const s of existing) {
    if (s && typeof s.articleId === 'string' && s.articleId) byId.set(s.articleId, s);
  }
  // Incoming overwrites existing on the same article id (freshest fields win).
  for (const s of incoming) {
    if (s && typeof s.articleId === 'string' && s.articleId) byId.set(s.articleId, s);
  }
  return [...byId.values()].sort((a, b) => (b.pubDateMs ?? 0) - (a.pubDateMs ?? 0)).slice(0, MAX_MEMBER_SNAPSHOTS);
}

/** Lean projection for the topic-linked reconcile path (v40). */

/** Lean projection of a legacy (topic-less) active story awaiting migration to
 *  the topic model. `titles` are the known member titles fed to the LLM scope
 *  generator that mints the tracked topic + display headline. */

/**
 * Sort active stories for display: those with unseen updates first, then
 * newest activity first. WatermelonDB can't express this compound order in a
 * query, so callers observe the raw active set and run it through here.
 */
function sortTrackedStories(rows) {
  const time = r => {
    const t = r.lastUpdateAt ?? r.createdAt;
    return t instanceof Date ? t.getTime() : Number(t ?? 0);
  };
  return [...rows].sort((a, b) => {
    const aUnseen = (a.unseenCount ?? 0) > 0 ? 1 : 0;
    const bUnseen = (b.unseenCount ?? 0) > 0 ? 1 : 0;
    if (aUnseen !== bUnseen) return bUnseen - aUnseen; // unseen first
    return time(b) - time(a); // newest activity first
  });
}

/**
 * Follow a story. Pure create — enrichment (headline, extra members) happens
 * later via the reconcile poll + headline job. `member_article_ids` seeds with
 * the tapped article; `fallback_title` always renders until a headline exists.
 */
async function trackStory(input) {
  const articleId = (input.articleId ?? '').trim();
  const title = (input.title ?? '').trim();
  const stableClusterId = input.stableClusterId?.trim() || null;
  const originSurface = input.originSurface?.trim() || null;
  const topicId = input.topicId?.trim() || null;
  const topicText = input.topicText?.trim() || null;
  const llmHeadline = input.llmHeadline?.trim() || null;
  const initialSnapshot = input.initialSnapshot && input.initialSnapshot.articleId ? [input.initialSnapshot] : [];
  let created;
  await _index.default.write(async () => {
    created = await collection.create(m => {
      m.stableClusterId = stableClusterId;
      m.memberArticleIds = articleId ? [articleId] : [];
      m.llmHeadline = llmHeadline;
      m.fallbackTitle = title;
      m.latestArticleId = articleId || null;
      m.originSurface = originSurface;
      m.lastUpdateAt = null;
      m.unseenCount = 0;
      // Seed the seen-pubDate watermark at CREATION (Q15). Without it a fresh
      // story had `seen_pub_watermark_ms === null`, which sends `applyUpdates`
      // down its LEGACY `unseenCount += newIds.length` branch — so the very
      // first reconcile counted every pre-existing article it discovered about
      // this story as "new", and a story you just started following immediately
      // showed a double-digit new badge.
      //
      // The watermark is the newest pubDate the user has seen, and at creation
      // that is exactly the article they tapped: anything older is pre-existing
      // coverage (not new), anything newer genuinely postdates what they saw.
      //
      // The `> 0` guard matters, and 0 is NOT a usable watermark: the gate is
      // `watermark != null`, so storing 0 would switch the story onto the gated
      // branch with an all-permissive threshold — gating in name only, which is
      // worse than either extreme. A seed with no pubDate falls back to "now",
      // which correctly treats all existing coverage as already-seen.
      m.seenPubWatermarkMs = initialSnapshot[0]?.pubDateMs && initialSnapshot[0].pubDateMs > 0 ? initialSnapshot[0].pubDateMs : Date.now();
      m.lastCheckedAt = null;
      m.missCount = 0;
      m.status = 'active';
      m.topicId = topicId;
      m.topicText = topicText;
      m.memberSnapshots = initialSnapshot;
    });
  });
  return created;
}

/**
 * Is this article a member of any ACTIVE followed story?
 *
 * The retention question, asked from the saved-suggestion service: a retention
 * row may only be destroyed once no reason still holds it. Reads the SNAPSHOTS,
 * not `member_article_ids` — the ids are the reconcile's already-considered
 * ledger and deliberately outlive a snapshot the reader disowned, so keying
 * retention on them would keep a row alive for an article the reader removed.
 */
async function isTrackedStoryMember(articleId) {
  const target = (articleId ?? '').trim();
  if (!target) return false;
  try {
    const rows = await collection.query(_watermelondb.Q.where('status', 'active')).fetch();
    return rows.some(r => (r.memberSnapshots ?? []).some(s => s?.articleId === target));
  } catch (err) {
    _logger.default.captureException(err, {
      tags: {
        service: 'tracked-story-service',
        method: 'isTrackedStoryMember'
      },
      extra: {
        articleId: target
      }
    });
    // Fail CLOSED for a destructive caller: an unreadable membership must not
    // read as "nothing references this", which would drop a live retention row.
    return true;
  }
}

/** Every article id held by an active followed story's snapshots. The sweep's
 *  reference set — one query instead of one per candidate row. */
async function listTrackedMemberArticleIds() {
  try {
    const rows = await collection.query(_watermelondb.Q.where('status', 'active')).fetch();
    const ids = new Set();
    for (const r of rows) {
      for (const s of r.memberSnapshots ?? []) {
        if (s?.articleId) ids.add(s.articleId);
      }
    }
    return ids;
  } catch (err) {
    _logger.default.captureException(err, {
      tags: {
        service: 'tracked-story-service',
        method: 'listTrackedMemberArticleIds'
      }
    });
    // Rethrows so callers fail closed: an empty Set would read as "nothing is
    // held" and let the sweep destroy rows a followed story still needs.
    throw err;
  }
}

/**
 * Unfollow a story (hard delete). Never throws.
 *
 * Returns true when the row is gone afterwards, INCLUDING when it was already
 * absent (deleted from another surface): that is the state the caller asked
 * for. False only when the delete itself failed, so a screen can stay put and
 * say so instead of navigating away from a story that still exists.
 *
 * Looked up by query + a JS id match rather than `collection.find`, which
 * rejects on a missing id and would make "already gone" indistinguishable
 * from a failed read.
 */
async function untrackStory(id) {
  try {
    const rows = await collection.query(_watermelondb.Q.where('id', id)).fetch();
    const record = rows.find(r => r.id === id);
    if (!record) return true;
    await _index.default.write(async () => {
      await record.destroyPermanently();
    });
    return true;
  } catch (err) {
    _logger.default.warn('[tracked-story] untrackStory failed', {
      id,
      error: String(err)
    });
    return false;
  }
}

/**
 * Is a story already followed? Matches on either the resolved stable cluster id
 * or membership of the given article id. At least one key must be supplied.
 * Only ACTIVE stories count (an ended story is not "tracked").
 */
/** Identity keys that decide whether a story is "the one" being asked about. */

const normalizeScopeText = text => (text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Trimmed, non-empty form of a {@link TrackedMatchQuery}; null when no key
 *  (id or search text) carries a usable value (nothing can match). */
function normalizeTrackedQuery(query) {
  const stableClusterId = query.stableClusterId?.trim() || null;
  const articleId = query.articleId?.trim() || null;
  const searchText = normalizeScopeText(query.searchText) || null;
  if (!stableClusterId && !articleId && !searchText) return null;
  return {
    stableClusterId,
    articleId,
    searchText
  };
}

/**
 * THE tracked-match predicate. Extracted because three call sites — `isTracked`,
 * `observeTracked`, and `findActiveTrackedId` — must agree exactly: the reactive
 * observer answering differently from the one-shot read is precisely the drift
 * that would put the track button back out of sync with reality.
 *
 * With a searchText, an id match also needs the same scope; a row with no
 * topicText (legacy) matches any scope of its article. Without ids, the scope
 * text alone matches (free-text follows).
 */
function matchesTrackedQuery(row, norm) {
  const rowScope = normalizeScopeText(row.topicText);
  const scopeOk = !norm.searchText || !rowScope || rowScope === norm.searchText;
  const idMatch = !!norm.stableClusterId && row.stableClusterId === norm.stableClusterId || !!norm.articleId && (row.memberArticleIds ?? []).includes(norm.articleId);
  if (idMatch) return scopeOk;
  if (!norm.stableClusterId && !norm.articleId) return !!norm.searchText && rowScope === norm.searchText;
  return false;
}
async function isTracked(query) {
  const norm = normalizeTrackedQuery(query);
  if (!norm) return false;
  const rows = await collection.query(_watermelondb.Q.where('status', 'active')).fetch();
  return rows.some(r => matchesTrackedQuery(r, norm));
}

/**
 * Reactive form of {@link isTracked} — emits the current tracked flag and
 * re-emits whenever it could change.
 *
 * Exists because the one-shot read left the track button permanently stale: the
 * story is minted only after the user confirms a proposal inside the FLOATING
 * chat, which outlives the screen that owns the button, so a screen that stayed
 * mounted never learned it was now tracking — and the next tap started a second
 * proposal for a story already being followed.
 *
 * `member_article_ids_json` is in the observed column list on purpose: a story the
 * user follows can absorb THIS article later via the topic reconcile, and the
 * button must flip then too, not just when a row is added or removed.
 */
function observeTracked(query) {
  return observeTrackedId(query).pipe((0, _rxjs.map)(id => id !== null));
}

/**
 * Reactive form of {@link findActiveTrackedId} — the matching active story's id,
 * or null. The track button needs the ID (not just a flag) so its
 * "already following" dialog can offer "Go to story", and deriving the flag from
 * the id keeps one subscription and one predicate behind both.
 */
function observeTrackedId(query) {
  const norm = normalizeTrackedQuery(query);
  return collection.query(_watermelondb.Q.where('status', 'active')).observeWithColumns(['member_article_ids_json', 'status']).pipe((0, _rxjs.map)(rows => {
    if (!norm) return null;
    return rows.find(r => matchesTrackedQuery(r, norm))?.id ?? null;
  }));
}

/**
 * Reactive active-story set. Re-emits when the columns that affect ordering /
 * the badge change. Sorted via `sortTrackedStories` (unseen first, newest next).
 */
function observeActive() {
  return collection.query(_watermelondb.Q.where('status', 'active')).observeWithColumns(['unseen_count', 'last_update_at', 'llm_headline']).pipe((0, _rxjs.map)(rows => sortTrackedStories(rows)));
}

/** Reactive total unseen count across active stories — drives the tab badge. */
function observeUnseenTotal() {
  return collection.query(_watermelondb.Q.where('status', 'active')).observeWithColumns(['unseen_count']).pipe((0, _rxjs.map)(rows => rows.filter(r => r.status === 'active').reduce((sum, r) => sum + (r.unseenCount ?? 0), 0)));
}

/** Clear a story's unseen badge (user viewed its updates). Never throws. */
async function markSeen(id) {
  try {
    const record = await collection.find(id);
    await _index.default.write(async () => {
      await record.update(m => {
        m.unseenCount = 0;
      });
    });
  } catch (err) {
    _logger.default.warn('[tracked-story] markSeen failed', {
      id,
      error: String(err)
    });
  }
}

/**
 * Grow a story with newly-found member articles: prepend the new ids
 * (newest-first, capped at MAX_MEMBER_IDS), bump `unseen_count`, stamp `last_update_at`,
 * and reset the miss streak. Optionally refresh the "latest" pointer. Never
 * throws.
 *
 * The `unseen_count` bump is WATERMARK-GATED (schema v44): when the caller
 * passes `newSnapshots` (so we know each new member's pubDate) AND the story
 * has a `seen_pub_watermark_ms` set (the user has opened the timeline at least
 * once), only members published strictly AFTER that watermark count as "new" —
 * so backfilled OLD articles the pipeline just discovered don't inflate the
 * badge. A snapshot with pubDateMs 0/undefined counts as OLD (deliberate
 * backfill safety). Otherwise (no snapshots — the legacy cluster/poll path — or
 * a null watermark) we fall back to the legacy `+= newIds.length`.
 */
async function applyUpdates(id, updates) {
  const newIds = (updates.newMemberIds ?? []).filter(x => typeof x === 'string' && x.trim().length > 0);
  try {
    const record = await collection.find(id);
    await _index.default.write(async () => {
      await record.update(m => {
        const existing = m.memberArticleIds ?? [];
        m.memberArticleIds = [...newIds, ...existing].slice(0, MAX_MEMBER_IDS);
        const snapshots = updates.newSnapshots;
        const watermark = m.seenPubWatermarkMs;
        if (snapshots && snapshots.length > 0 && watermark != null) {
          // Watermark-gated: only members newer than the last-seen watermark.
          // Counts STORIES, not copies: a snapshot sharing a fold key with a
          // member already on the row, or with an earlier new one, adds 0.
          const seen = new Set();
          for (const s of m.memberSnapshots ?? []) for (const k of (0, _storyFoldKey.foldKeysOf)(s)) seen.add(k);
          for (const s of snapshots) {
            if ((s.pubDateMs ?? 0) <= watermark) for (const k of (0, _storyFoldKey.foldKeysOf)(s)) seen.add(k);
          }
          let fresh = 0;
          const above = snapshots.filter(s => (s.pubDateMs ?? 0) > watermark).sort((a, b) => (a.pubDateMs ?? 0) - (b.pubDateMs ?? 0));
          for (const s of above) {
            const keys = (0, _storyFoldKey.foldKeysOf)(s);
            if (!keys.some(k => seen.has(k))) fresh++;
            for (const k of keys) seen.add(k);
          }
          m.unseenCount = (m.unseenCount ?? 0) + fresh;
        } else {
          // Legacy path — no per-member pubDate, or never opened yet.
          m.unseenCount = (m.unseenCount ?? 0) + newIds.length;
        }
        m.lastUpdateAt = new Date();
        m.missCount = 0;
        if (snapshots && snapshots.length > 0) {
          m.memberSnapshots = mergeMemberSnapshots(m.memberSnapshots ?? [], snapshots);
        }
        if (updates.latestArticleId) m.latestArticleId = updates.latestArticleId;
      });
    });
  } catch (err) {
    _logger.default.warn('[tracked-story] applyUpdates failed', {
      id,
      error: String(err)
    });
  }
}

/**
 * Remove ONE member article from a story's TIMELINE — the "not part of this
 * story" per-card action.
 *
 * DROPS THE SNAPSHOT, KEEPS THE MEMBER ID, and that asymmetry is the entire
 * design, not an oversight:
 *
 *   - `member_snapshots_json` is EXACTLY what the timeline renders:
 *     StoryTimelineScreen builds its cards with `buildTimeline(memberSnapshots)`
 *     and `hydrateSource` only maps over the cards it is handed, so
 *     `member_article_ids` never contributes a card. Dropping the snapshot is
 *     what makes the card disappear.
 *   - `member_article_ids` is the reconcile's ALREADY-CONSIDERED ledger. Every
 *     feed sync re-derives membership from scratch —
 *     `fresh = candidates.filter((r) => !existing.has(r.id))` in
 *     tracked-story-reconcile — against the whole local `article_suggestions`
 *     set with no status filter. Remove the id and the very next sync (60s)
 *     re-adds the member and its snapshot, and the card the user just dismissed
 *     comes straight back.
 *
 * So the id IS the record of the removal, and keeping it needs no deny list, no
 * tombstone column, and no change to how the reconcile grows.
 *
 * THE GUARANTEE IS BOUNDED, and the bound is {@link MAX_MEMBER_IDS}: a story
 * gathering that many further members while this article's row is still on
 * device would evict the id and bring the card back. Do not "fix" it by
 * re-introducing a member-id deny list.
 *
 * The member COUNT on the stories list is derived from `member_article_ids`, so
 * it deliberately still counts this article: the story really did gather that
 * coverage, the user only asked not to see it on the timeline.
 *
 * `unseen_count` is left alone on purpose. The timeline zeroes it via
 * `markSeen` on every focus and `advanceSeenWatermark` only ever moves forward,
 * so the badge is already 0 by the time a card on that screen can be dismissed.
 *
 * No-op (and NO write, so the `observeWithColumns` subscribers don't re-render)
 * when the article isn't a snapshot. Never throws: returns true when the
 * article is no longer a snapshot afterwards (removed, never a member, or the
 * story itself is gone) and false only when the write failed, so the timeline
 * can undo its optimistic removal.
 */
async function removeMemberSnapshot(id, articleId) {
  const target = (articleId ?? '').trim();
  if (!target) return true;
  try {
    const rows = await collection.query(_watermelondb.Q.where('id', id)).fetch();
    const record = rows.find(r => r.id === id);
    if (!record) return true; // story gone, so the member is too
    const isMember = () => record.memberSnapshots.some(s => s?.articleId === target);
    if (!isMember()) return true; // not a member: nothing to write
    // Filter INSIDE the writer: parallel callers (a folded entry disowns every
    // copy at once) each filtering a list read before the queue would let the
    // last write put back a copy an earlier one removed.
    await _index.default.write(async () => {
      if (!isMember()) return;
      const next = record.memberSnapshots.filter(s => s?.articleId !== target);
      await record.update(m => {
        m.memberSnapshots = next;
      });
    });
    return true;
  } catch (err) {
    _logger.default.warn('[tracked-story] removeMemberSnapshot failed', {
      id,
      error: String(err)
    });
    return false;
  }
}

/** The source fields a snapshot can be missing — see {@link backfillSnapshotSource}. */

/**
 * Fill in `languageCode` / `countryCode` / `publicationName` / `storyKey` / `titleOriginal` on member snapshots
 * that predate those fields (or were seeded from a source that never carried
 * them, e.g. the originating article of a freshly-followed story). The timeline
 * screen resolves them from the local `article_suggestions` rows and persists
 * them here, so the row keeps its language label and flag after the suggestion
 * is pruned out of the 24h window.
 *
 * FILL-ONLY: a field already present on the snapshot is never overwritten, and
 * a story with nothing to fill is not written at all. Swallows errors — a failed
 * backfill must not break the timeline.
 */
async function backfillSnapshotSource(id, patches) {
  if (patches.size === 0) return;
  try {
    const record = await collection.find(id);
    const current = record.memberSnapshots ?? [];
    let changed = false;
    const next = current.map(s => {
      const p = patches.get(s.articleId);
      if (!p) return s;
      const merged = {
        ...s
      };
      if (!merged.languageCode && p.languageCode) merged.languageCode = p.languageCode;
      if (!merged.countryCode && p.countryCode) merged.countryCode = p.countryCode;
      if (!merged.publicationName && p.publicationName) merged.publicationName = p.publicationName;
      if (!merged.storyKey && p.storyKey) merged.storyKey = p.storyKey;
      if (!merged.titleOriginal && p.titleOriginal) merged.titleOriginal = p.titleOriginal;
      if (merged.languageCode === s.languageCode && merged.countryCode === s.countryCode && merged.publicationName === s.publicationName && merged.storyKey === s.storyKey && merged.titleOriginal === s.titleOriginal) {
        return s;
      }
      changed = true;
      return merged;
    });
    if (!changed) return;
    await _index.default.write(async () => {
      await record.update(m => {
        m.memberSnapshots = next;
      });
    });
  } catch (err) {
    _logger.default.warn('[tracked-story] backfillSnapshotSource failed', {
      id,
      error: String(err)
    });
  }
}

/**
 * Advance a story's seen-pubDate watermark (schema v44) — the newest member
 * pubDate the user has actually seen. Called by the timeline screen after a
 * SUCCESSFUL load with the max pubDate on screen. Monotonic: never moves the
 * watermark backwards (`Math.max(current ?? 0, watermarkMs)`), so a later load
 * that happens to render an older subset can't re-inflate future badges. Swallows
 * errors (never throws — a failed watermark write must not break the screen).
 */
async function advanceSeenWatermark(id, watermarkMs) {
  if (!Number.isFinite(watermarkMs) || watermarkMs <= 0) return;
  try {
    const record = await collection.find(id);
    await _index.default.write(async () => {
      await record.update(m => {
        m.seenPubWatermarkMs = Math.max(m.seenPubWatermarkMs ?? 0, watermarkMs);
      });
    });
  } catch (err) {
    _logger.default.warn('[tracked-story] advanceSeenWatermark failed', {
      id,
      error: String(err)
    });
  }
}

/**
 * Resolve the row id of the ACTIVE story matching a subject (by stable cluster
 * id or member article id) — the seam the follow UI uses to untrack from a card
 * subject. Returns null when nothing matches. Mirrors {@link isTracked}'s match
 * rules. Never throws.
 */
async function findActiveTrackedId(query) {
  const norm = normalizeTrackedQuery(query);
  if (!norm) return null;
  try {
    const rows = await collection.query(_watermelondb.Q.where('status', 'active')).fetch();
    const match = rows.find(r => matchesTrackedQuery(r, norm));
    return match?.id ?? null;
  } catch (err) {
    _logger.default.warn('[tracked-story] findActiveTrackedId failed', {
      error: String(err)
    });
    return null;
  }
}

/** One-shot read of a single story row by id (any status). Null when missing. */
async function getTrackedStoryById(id) {
  try {
    return await collection.find(id);
  } catch {
    return null;
  }
}

/** Write the generated English headline for a story. No-op on blank. Never throws. */
async function setLlmHeadline(id, headline) {
  const h = (headline ?? '').trim();
  if (!h) return;
  try {
    const record = await collection.find(id);
    await _index.default.write(async () => {
      await record.update(m => {
        m.llmHeadline = h;
      });
    });
  } catch (err) {
    _logger.default.warn('[tracked-story] setLlmHeadline failed', {
      id,
      error: String(err)
    });
  }
}

/**
 * Active TOPIC-linked stories (v40) — the topic reconcile path's work list.
 * A story is topic-linked once it carries a `topic_id`; the reconcile matches
 * fresh suggestions whose `matched_topics` contain that id. Returns a lean
 * projection so the reconcile never holds live models.
 */
async function getActiveForTopicReconcile() {
  const rows = await collection.query(_watermelondb.Q.where('status', 'active')).fetch();
  return rows.filter(r => r.status === 'active' && !!r.topicId) // JS guard for test mock
  .map(r => ({
    id: r.id,
    topicId: r.topicId,
    memberArticleIds: r.memberArticleIds ?? []
  }));
}

/**
 * Active stories still on the legacy stable-cluster model (no `topic_id`) — the
 * one-shot migration work list. Each carries the story's known `titles` (its
 * display headline, fallback title, and member-snapshot titles, de-duplicated)
 * that the LLM scope generator turns into a tracked topic + display headline.
 * Rows with no usable titles are dropped (nothing to scope on). Never throws.
 */
async function getLegacyTrackedForMigration() {
  try {
    const rows = await collection.query(_watermelondb.Q.where('status', 'active')).fetch();
    return rows.filter(r => r.status === 'active' && !r.topicId) // JS guard for test mock
    .map(r => {
      const seen = new Set();
      const titles = [];
      for (const raw of [r.llmHeadline, r.fallbackTitle, ...(r.memberSnapshots ?? []).map(s => s.title)]) {
        const t = (raw ?? '').trim();
        if (t && !seen.has(t)) {
          seen.add(t);
          titles.push(t);
        }
      }
      return {
        id: r.id,
        titles
      };
    }).filter(r => r.titles.length > 0);
  } catch (err) {
    _logger.default.warn('[tracked-story] getLegacyTrackedForMigration failed', {
      error: String(err)
    });
    return [];
  }
}

/**
 * Bind a minted topic (id + text) onto a story — the migration setter that
 * converts a legacy stable-cluster follow into a topic-linked one. No-op on
 * blank text. Never throws.
 */
async function bindTrackedTopic(id, topicId, topicText) {
  const text = (topicText ?? '').trim();
  if (!text) return;
  try {
    const record = await collection.find(id);
    await _index.default.write(async () => {
      await record.update(m => {
        m.topicId = topicId;
        m.topicText = text;
      });
    });
  } catch (err) {
    _logger.default.warn('[tracked-story] bindTrackedTopic failed', {
      id,
      error: String(err)
    });
  }
}

/** Stamp a story as just-checked by the reconcile. Never throws. */
async function stampChecked(id) {
  try {
    const record = await collection.find(id);
    await _index.default.write(async () => {
      await record.update(m => {
        m.lastCheckedAt = new Date();
      });
    });
  } catch (err) {
    _logger.default.warn('[tracked-story] stampChecked failed', {
      id,
      error: String(err)
    });
  }
}