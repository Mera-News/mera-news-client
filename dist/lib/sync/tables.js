"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SyncVersionError = exports.SYNC_TABLES = exports.SHARED_SETTING_KEYS = exports.PROFILE_TABLES = exports.POD_OWNED_SETTING_KEYS = exports.PHONE_WINS_SETTING_KEYS = exports.PHONE_ONLY_TABLES = exports.MARK_TABLES = void 0;
exports.assertSameVersions = assertSameVersions;
exports.isAppliedSettingKey = isAppliedSettingKey;
exports.isSharedSettingKey = isSharedSettingKey;
exports.isSyncSettingKey = isSyncSettingKey;
const replace = name => ({
  name,
  mode: 'replace'
});

/** Every table a snapshot carries. `settings` is a pseudo-table limited to the keys below. */
const SYNC_TABLES = exports.SYNC_TABLES = [...['article_suggestions', 'article_suggestion_facts', 'fact_checks', 'persona_summary_strings', 'persona_change_log', 'facts', 'topics', 'declined_topics', 'persona_suppressions', 'locations', 'tracked_stories', 'saved_article_suggestions', 'publication_visits', 'story_impressions', 'article_feedback', 'publication_preferences', 'user_publication_subscriptions'].map(replace), {
  name: 'notifications',
  mode: 'merge'
}, replace('settings')];

/** Tables that belong to the phone alone: never in a snapshot, never touched by an apply. */
/** The tables a person's profile is made of: what a pod's profile is replaced with at pairing. */
const PROFILE_TABLES = exports.PROFILE_TABLES = ['facts', 'topics', 'declined_topics', 'persona_suppressions', 'locations', 'persona_summary_strings', 'persona_change_log', 'publication_preferences', 'user_publication_subscriptions', 'tracked_stories', 'saved_article_suggestions'];
const PHONE_ONLY_TABLES = exports.PHONE_ONLY_TABLES = ['conversations', 'messages', 'user_personas', 'scheduler_jobs', 'inference_jobs', 'translation_cache'];

/** Tables the local-first batch writes to, by the kind of mark. */
const MARK_TABLES = exports.MARK_TABLES = {
  open: 'story_impressions',
  visit: 'publication_visits',
  seen: 'tracked_stories',
  watermark: 'tracked_stories'
};

/** Served and applied. The phone never writes them. */
const POD_OWNED_SETTING_KEYS = exports.POD_OWNED_SETTING_KEYS = ['feed_metadata', 'hygiene_pending_proposals', 'hygiene_proposal_backlog'];

/** Served and applied. A phone write goes through a command, so a pull never reverts it. */
const SHARED_SETTING_KEYS = exports.SHARED_SETTING_KEYS = ['hygiene_rejected_fingerprints', 'app_language', 'mera_skip_notes', 'for_you_recent_24h_only'];
const SHARED_SETTING_PREFIX = 'explore_';

/** Served, never applied: each device keeps its own value. */
const PHONE_WINS_SETTING_KEYS = exports.PHONE_WINS_SETTING_KEYS = ['feed_card_state_v1'];
function isSharedSettingKey(key) {
  return SHARED_SETTING_KEYS.includes(key) || key.startsWith(SHARED_SETTING_PREFIX);
}

/** Keys a snapshot carries. The lists are explicit, so no identity key can match. */
function isSyncSettingKey(key) {
  return POD_OWNED_SETTING_KEYS.includes(key) || isSharedSettingKey(key) || PHONE_WINS_SETTING_KEYS.includes(key);
}

/** Keys an apply may write on a phone. */
function isAppliedSettingKey(key) {
  return isSyncSettingKey(key) && !PHONE_WINS_SETTING_KEYS.includes(key);
}
/** `which` is the side that is older and needs updating. */
class SyncVersionError extends Error {
  constructor(which) {
    super(`The ${which} is on an older version than the other side`);
    this.which = which;
    this.name = 'SyncVersionError';
  }
}

/** Throws when either version differs; `local` is this side, `remote` the other. */
exports.SyncVersionError = SyncVersionError;
function assertSameVersions(local, remote, localIs) {
  const other = localIs === 'phone' ? 'server' : 'phone';
  for (const field of ['schemaVersion', 'registry']) {
    if (local[field] === remote[field]) continue;
    throw new SyncVersionError(local[field] < remote[field] ? localIs : other);
  }
}