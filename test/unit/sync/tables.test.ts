import { FORBIDDEN_SETTING_KEYS } from '@/lib/backup/allowlist';
import appSchema from '@/lib/database/schema';
import {
  MARK_TABLES,
  PHONE_ONLY_TABLES,
  PHONE_WINS_SETTING_KEYS,
  PROFILE_TABLES,
  POD_OWNED_SETTING_KEYS,
  SHARED_SETTING_KEYS,
  SYNC_TABLES,
  isAppliedSettingKey,
  isSharedSettingKey,
  isSyncSettingKey,
} from '@/lib/sync/tables';

describe('sync tables', () => {
  it('puts every schema table in exactly one of the served set and the phone-only set', () => {
    const served = SYNC_TABLES.map((t) => t.name);
    for (const table of Object.keys(appSchema.tables)) {
      const inServed = served.includes(table);
      const inPhoneOnly = PHONE_ONLY_TABLES.includes(table);
      expect([table, inServed !== inPhoneOnly]).toEqual([table, true]);
    }
    for (const name of [...served, ...PHONE_ONLY_TABLES]) expect(appSchema.tables).toHaveProperty(name);
  });

  it('names the phone-only tables', () => {
    expect([...PHONE_ONLY_TABLES].sort()).toEqual(
      ['conversations', 'inference_jobs', 'messages', 'scheduler_jobs', 'translation_cache', 'user_personas'],
    );
  });

  it('merges notifications and replaces every other table', () => {
    for (const t of SYNC_TABLES) expect(t.mode).toBe(t.name === 'notifications' ? 'merge' : 'replace');
  });

  it('never lets an identity key travel', () => {
    for (const key of Object.keys(FORBIDDEN_SETTING_KEYS)) expect(isSyncSettingKey(key)).toBe(false);
    expect(isSyncSettingKey('feed_metadata')).toBe(true);
    expect(isSyncSettingKey('explore_browse_countries')).toBe(true);
    expect(isSyncSettingKey('theme')).toBe(false);
  });

  it('keeps the three kinds of setting key apart and free of identity keys', () => {
    const sets = [POD_OWNED_SETTING_KEYS, SHARED_SETTING_KEYS, PHONE_WINS_SETTING_KEYS];
    const all = sets.flat();
    expect(new Set(all).size).toBe(all.length);
    expect(PHONE_WINS_SETTING_KEYS).toEqual(['feed_card_state_v1']);
    for (const key of all) expect(Object.keys(FORBIDDEN_SETTING_KEYS)).not.toContain(key);
    expect(isSharedSettingKey('app_language')).toBe(true);
    expect(isSharedSettingKey('explore_suppressed_scopes')).toBe(true);
    expect(isSharedSettingKey('feed_metadata')).toBe(false);
    expect(isSharedSettingKey('feed_card_state_v1')).toBe(false);
    expect(isSyncSettingKey('feed_card_state_v1')).toBe(true);
    expect(isAppliedSettingKey('feed_card_state_v1')).toBe(false);
    expect(isAppliedSettingKey('feed_metadata')).toBe(true);
  });

  it('does not count a card state mark as a change to any table', () => {
    expect(Object.keys(MARK_TABLES)).not.toContain('cardState');
  });
});

it('the profile tables are the eleven a pairing replaces, every one of them served', () => {
  expect([...PROFILE_TABLES].sort()).toEqual([
    'declined_topics', 'facts', 'locations', 'persona_change_log', 'persona_summary_strings', 'persona_suppressions',
    'publication_preferences', 'saved_article_suggestions', 'topics', 'tracked_stories', 'user_publication_subscriptions',
  ]);
  const served = new Set(SYNC_TABLES.map((t) => t.name));
  expect(PROFILE_TABLES.filter((t) => !served.has(t))).toEqual([]);
});
