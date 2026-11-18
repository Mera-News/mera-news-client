"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _watermelondb = require("@nozbe/watermelondb");
var _decorators = require("@nozbe/watermelondb/decorators");
var _trackedStorySnapshots = require("../../algorithms/tracked-story-snapshots");
var _dec, _dec2, _dec3, _dec4, _dec5, _dec6, _dec7, _dec8, _dec9, _dec0, _dec1, _dec10, _dec11, _dec12, _dec13, _dec14, _dec15, _class, _descriptor, _descriptor2, _descriptor3, _descriptor4, _descriptor5, _descriptor6, _descriptor7, _descriptor8, _descriptor9, _descriptor0, _descriptor1, _descriptor10, _descriptor11, _descriptor12, _descriptor13, _descriptor14, _descriptor15, _TrackedStory;
function _initializerDefineProperty(e, i, r, l) { r && Object.defineProperty(e, i, { enumerable: r.enumerable, configurable: r.configurable, writable: r.writable, value: r.initializer ? r.initializer.call(l) : void 0 }); }
function _applyDecoratedDescriptor(i, e, r, n, l) { var a = {}; return Object.keys(n).forEach(function (i) { a[i] = n[i]; }), a.enumerable = !!a.enumerable, a.configurable = !!a.configurable, ("value" in a || a.initializer) && (a.writable = !0), a = r.slice().reverse().reduce(function (r, n) { return n(i, e, r) || r; }, a), l && void 0 !== a.initializer && (a.value = a.initializer ? a.initializer.call(l) : void 0, a.initializer = void 0), void 0 === a.initializer ? (Object.defineProperty(i, e, a), null) : a; }
function _initializerWarningHelper(r, e) { throw Error("Decorating class property failed. Please ensure that transform-class-properties is enabled and runs after the decorators transform."); }
/** Coerce the persisted JSON column into a clean string[] (defensive). */
const sanitizeIds = raw => Array.isArray(raw) ? raw.filter(x => typeof x === 'string') : [];

/**
 * A user-followed ("tracked") news story (schema v39). Long-lived, user-owned
 * state — migrated, never wiped.
 *
 * Once `stableClusterId` is resolved, the reconcile poll matches new server
 * cluster members against `memberArticleIds` and calls `applyUpdates` to grow
 * the story + bump `unseenCount`. `llmHeadline` is the generated English
 * one-liner (rendered downstream via TranslatableDynamic); `fallbackTitle` is
 * captured at track time and always renders until a headline exists.
 * This file is only the table, model, and CRUD service; the follow UI and
 * reconcile poll live elsewhere.
 */
let TrackedStory = exports.default = (_dec = (0, _decorators.field)('stable_cluster_id'), _dec2 = (0, _decorators.json)('member_article_ids_json', sanitizeIds), _dec3 = (0, _decorators.field)('llm_headline'), _dec4 = (0, _decorators.field)('fallback_title'), _dec5 = (0, _decorators.field)('latest_article_id'), _dec6 = (0, _decorators.field)('origin_surface'), _dec7 = (0, _decorators.date)('last_update_at'), _dec8 = (0, _decorators.field)('unseen_count'), _dec9 = (0, _decorators.date)('last_checked_at'), _dec0 = (0, _decorators.field)('miss_count'), _dec1 = (0, _decorators.field)('status'), _dec10 = (0, _decorators.field)('topic_id'), _dec11 = (0, _decorators.field)('topic_text'), _dec12 = (0, _decorators.json)('member_snapshots_json', _trackedStorySnapshots.sanitizeSnapshots), _dec13 = (0, _decorators.field)('seen_pub_watermark_ms'), _dec14 = (0, _decorators.date)('created_at'), _dec15 = (0, _decorators.date)('updated_at'), _class = (_TrackedStory = class TrackedStory extends _watermelondb.Model {
  constructor(...args) {
    super(...args);
    _initializerDefineProperty(this, "stableClusterId", _descriptor, this);
    _initializerDefineProperty(this, "memberArticleIds", _descriptor2, this);
    _initializerDefineProperty(this, "llmHeadline", _descriptor3, this);
    _initializerDefineProperty(this, "fallbackTitle", _descriptor4, this);
    _initializerDefineProperty(this, "latestArticleId", _descriptor5, this);
    // `latest_title` was here. It was written once at track time with the title
    // of the article the user tapped and then almost never replaced, so what it
    // actually held was the story's ORIGIN headline — which the tracked-stories
    // list rendered under the real headline as if it were news. Dropped from the
    // model and NULLed on disk by migration v52. The column itself survives on
    // upgraded devices (WatermelonDB has no destroyColumn) but is inert.
    _initializerDefineProperty(this, "originSurface", _descriptor6, this);
    _initializerDefineProperty(this, "lastUpdateAt", _descriptor7, this);
    _initializerDefineProperty(this, "unseenCount", _descriptor8, this);
    _initializerDefineProperty(this, "lastCheckedAt", _descriptor9, this);
    _initializerDefineProperty(this, "missCount", _descriptor0, this);
    _initializerDefineProperty(this, "status", _descriptor1, this);
    // ── Topic-linked tracking (schema v40) ──────────────────────────────
    // The minted `topics` row this story follows. When set, the reconcile
    // matches suggestions by `topic_id` (not cluster id) and the story never
    // auto-ends via cluster misses — the topic keeps linking server-side.
    _initializerDefineProperty(this, "topicId", _descriptor10, this);
    _initializerDefineProperty(this, "topicText", _descriptor11, this);
    _initializerDefineProperty(this, "memberSnapshots", _descriptor12, this);
    // ── Watermark-gated "new" badge (schema v44) ─────────────────────────
    // Epoch ms of the newest member pubDate the user has SEEN (stamped by the
    // timeline screen after a successful load). The reconcile counts only
    // members published strictly after this toward `unseen_count`, so backfilled
    // OLD articles don't inflate the badge. Null ⇒ never opened ⇒ legacy count.
    _initializerDefineProperty(this, "seenPubWatermarkMs", _descriptor13, this);
    _initializerDefineProperty(this, "createdAt", _descriptor14, this);
    _initializerDefineProperty(this, "updatedAt", _descriptor15, this);
  }
}, _TrackedStory.table = 'tracked_stories', _TrackedStory), _descriptor = _applyDecoratedDescriptor(_class.prototype, "stableClusterId", [_dec], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor2 = _applyDecoratedDescriptor(_class.prototype, "memberArticleIds", [_dec2], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor3 = _applyDecoratedDescriptor(_class.prototype, "llmHeadline", [_dec3], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor4 = _applyDecoratedDescriptor(_class.prototype, "fallbackTitle", [_dec4], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor5 = _applyDecoratedDescriptor(_class.prototype, "latestArticleId", [_dec5], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor6 = _applyDecoratedDescriptor(_class.prototype, "originSurface", [_dec6], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor7 = _applyDecoratedDescriptor(_class.prototype, "lastUpdateAt", [_dec7], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor8 = _applyDecoratedDescriptor(_class.prototype, "unseenCount", [_dec8], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor9 = _applyDecoratedDescriptor(_class.prototype, "lastCheckedAt", [_dec9], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor0 = _applyDecoratedDescriptor(_class.prototype, "missCount", [_dec0], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor1 = _applyDecoratedDescriptor(_class.prototype, "status", [_dec1], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor10 = _applyDecoratedDescriptor(_class.prototype, "topicId", [_dec10], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor11 = _applyDecoratedDescriptor(_class.prototype, "topicText", [_dec11], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor12 = _applyDecoratedDescriptor(_class.prototype, "memberSnapshots", [_dec12], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor13 = _applyDecoratedDescriptor(_class.prototype, "seenPubWatermarkMs", [_dec13], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor14 = _applyDecoratedDescriptor(_class.prototype, "createdAt", [_dec14], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor15 = _applyDecoratedDescriptor(_class.prototype, "updatedAt", [_dec15], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _class);