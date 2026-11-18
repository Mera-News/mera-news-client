export type SyncMode = 'replace' | 'merge';

export interface SyncTable {
  readonly name: string;
  readonly mode: SyncMode;
}

const replace = (name: string): SyncTable => ({ name, mode: 'replace' });

/** Every table a snapshot carries. `settings` is a pseudo-table limited to the keys below. */
export const SYNC_TABLES: readonly SyncTable[] = [
  ...[
    'article_suggestions',
    'article_suggestion_facts',
    'fact_checks',
    'persona_summary_strings',
    'persona_change_log',
    'facts',
    'topics',
    'declined_topics',
    'persona_suppressions',
    'locations',
    'tracked_stories',
    'saved_article_suggestions',
    'publication_visits',
    'story_impressions',
    'article_feedback',
    'publication_preferences',
    'user_publication_subscriptions',
  ].map(replace),
  { name: 'notifications', mode: 'merge' },
  replace('settings'),
];

/** Tables that belong to the phone alone: never in a snapshot, never touched by an apply. */
export const PHONE_ONLY_TABLES: readonly string[] = [
  'conversations',
  'messages',
  'user_personas',
  'scheduler_jobs',
  'inference_jobs',
  'translation_cache',
];

/** Tables the local-first batch writes to, by the kind of mark. */
export const MARK_TABLES = {
  open: 'story_impressions',
  visit: 'publication_visits',
  seen: 'tracked_stories',
  watermark: 'tracked_stories',
} as const;

/** Served and applied. The phone never writes them. */
export const POD_OWNED_SETTING_KEYS: readonly string[] = ['feed_metadata', 'hygiene_pending_proposals', 'hygiene_proposal_backlog'];

/** Served and applied. A phone write goes through a command, so a pull never reverts it. */
export const SHARED_SETTING_KEYS: readonly string[] = [
  'hygiene_rejected_fingerprints',
  'app_language',
  'mera_skip_notes',
  'for_you_recent_24h_only',
];
const SHARED_SETTING_PREFIX = 'explore_';

/** Served, never applied: each device keeps its own value. */
export const PHONE_WINS_SETTING_KEYS: readonly string[] = ['feed_card_state_v1'];

export function isSharedSettingKey(key: string): boolean {
  return SHARED_SETTING_KEYS.includes(key) || key.startsWith(SHARED_SETTING_PREFIX);
}

/** Keys a snapshot carries. The lists are explicit, so no identity key can match. */
export function isSyncSettingKey(key: string): boolean {
  return POD_OWNED_SETTING_KEYS.includes(key) || isSharedSettingKey(key) || PHONE_WINS_SETTING_KEYS.includes(key);
}

/** Keys an apply may write on a phone. */
export function isAppliedSettingKey(key: string): boolean {
  return isSyncSettingKey(key) && !PHONE_WINS_SETTING_KEYS.includes(key);
}

export interface SyncPeer {
  readonly schemaVersion: number;
  readonly registry: number;
}

/** `which` is the side that is older and needs updating. */
export class SyncVersionError extends Error {
  constructor(readonly which: 'phone' | 'server') {
    super(`The ${which} is on an older version than the other side`);
    this.name = 'SyncVersionError';
  }
}

/** Throws when either version differs; `local` is this side, `remote` the other. */
export function assertSameVersions(local: SyncPeer, remote: SyncPeer, localIs: 'phone' | 'server'): void {
  const other = localIs === 'phone' ? 'server' : 'phone';
  for (const field of ['schemaVersion', 'registry'] as const) {
    if (local[field] === remote[field]) continue;
    throw new SyncVersionError(local[field] < remote[field] ? localIs : other);
  }
}
