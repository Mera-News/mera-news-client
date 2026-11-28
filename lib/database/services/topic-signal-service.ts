// Topic signals: when did one of a fact-made topic's rows last reach the Feed?
//
// The answer feeds the stale_topic proposal (fact-hygiene), which offers to
// remove a topic that has brought nothing for weeks. It is read off the stored
// rows rather than at score time, so it needs no hook in any scoring path: data
// cleanup stamps right before the 48h sweep deletes rows, and the hygiene sweep
// stamps before it looks, so every row that reached the Feed is seen once.

import { Q } from '@nozbe/watermelondb';
import database from '../index';
import type ArticleSuggestionModel from '../models/ArticleSuggestion';
import { ArticleSuggestionStatus } from '../article-suggestion-status';
import { RENDER_GATE } from '../../stores/fact-rows-selector';
import { FACT_MADE_PROVENANCES } from '../../news-harness/persona-management/fact-hygiene';
import { platform } from '../../platform';
import { normalizeTopicText, stampTopicSignals } from './topic-service';
import { getSetting, setSetting } from './setting-service';
import logger from '../../logger';

/** When stamping began on this device. Idle time is never counted from before it. */
export const TOPIC_SIGNAL_SINCE_KEY = 'topic_signal_since';

/** The matched topic texts of a stored row, minus the synthetic headline entries. */
function matchedTexts(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((m) => m && typeof m.topicId === 'string' && typeof m.text === 'string')
      .map((m) => normalizeTopicText(m.text))
      .filter((t) => t.length > 0);
  } catch {
    return [];
  }
}

/**
 * Stamp every fact-made topic whose text matched a row that reached the Feed
 * (relevance at the render gate or above, status complete) with that row's
 * time. Writes the start-of-stamping marker on first use. Skipped on a phone
 * paired with a server, which keeps its own topics. Never throws.
 */
export async function stampTopicSignalsFromFeed(nowMs: number = Date.now()): Promise<number> {
  try {
    if (platform('lib/database/services/topic-signal-service').podCommand) return 0;
    if (!(await getSetting(TOPIC_SIGNAL_SINCE_KEY))) {
      await setSetting(TOPIC_SIGNAL_SINCE_KEY, String(nowMs));
    }
    const rows = await database
      .get<ArticleSuggestionModel>('article_suggestions')
      .query(
        Q.where('relevance', Q.gte(RENDER_GATE)),
        Q.where('status', ArticleSuggestionStatus.Complete),
      )
      .fetch();
    const latestByText = new Map<string, number>();
    for (const row of rows) {
      if (row.relevance < RENDER_GATE || row.status !== ArticleSuggestionStatus.Complete) continue;
      const at = row.scoredAt ?? (row.createdAt instanceof Date ? row.createdAt.getTime() : nowMs);
      for (const text of matchedTexts(row.matchedTopicsJson)) {
        if ((latestByText.get(text) ?? 0) < at) latestByText.set(text, at);
      }
    }
    return await stampTopicSignals(latestByText, FACT_MADE_PROVENANCES);
  } catch (err) {
    logger.captureException(err, {
      tags: { service: 'topic-signal-service', method: 'stampTopicSignalsFromFeed' },
    });
    return 0;
  }
}

/** The start-of-stamping marker, or null before the first stamp run. */
export async function readTopicSignalSince(): Promise<number | null> {
  const raw = Number(await getSetting(TOPIC_SIGNAL_SINCE_KEY).catch(() => null));
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}
