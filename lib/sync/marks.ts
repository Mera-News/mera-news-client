import type { RecordPublicationVisitInput } from '../database/services/publication-visit-service';
import type { RecordImpressionInput } from '../database/services/story-impression-service';
import { MARK_TABLES } from './tables';

export interface MarksBatch {
  opens: RecordImpressionInput[];
  visits: RecordPublicationVisitInput[];
  seen: string[];
  watermarks: { id: string; ms: number }[];
  cardState: Record<string, unknown> | null;
}

export type MarkInput =
  | { kind: 'open'; payload: RecordImpressionInput }
  | { kind: 'visit'; payload: RecordPublicationVisitInput }
  | { kind: 'seen'; payload: string }
  | { kind: 'watermark'; payload: { id: string; ms: number } }
  | { kind: 'cardState'; payload: Record<string, unknown> };

const empty = (): MarksBatch => ({ opens: [], visits: [], seen: [], watermarks: [], cardState: null });

/** The local-first batch of display marks, held until the next flush. */
export function createMarkBatch() {
  let batch = empty();
  const listeners = new Set<(tables: ReadonlySet<string>) => void>();

  const recordMark = <K extends MarkInput['kind']>(kind: K, payload: Extract<MarkInput, { kind: K }>['payload']): void => {
    if (kind === 'open') batch.opens.push(payload as RecordImpressionInput);
    else if (kind === 'visit') batch.visits.push(payload as RecordPublicationVisitInput);
    else if (kind === 'seen') batch.seen.push(payload as string);
    else if (kind === 'watermark') batch.watermarks.push(payload as { id: string; ms: number });
    else batch.cardState = payload as Record<string, unknown>; // last value wins
    for (const l of listeners) l(kind === 'cardState' ? new Set() : new Set([MARK_TABLES[kind as keyof typeof MARK_TABLES]]));
  };

  return {
    recordMark,
    hasPending,
    pendingTables,
    /** Empties the batch. `batch` is null when nothing was marked. */
    takeBatch(): { batch: MarksBatch | null; tables: Set<string> } {
      const tables = pendingTables();
      const taken = hasPending() ? batch : null;
      batch = empty();
      return { batch: taken, tables };
    },
    onMark(listener: (tables: ReadonlySet<string>) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  function pendingTables(): Set<string> {
    const t = new Set<string>();
    if (batch.opens.length) t.add(MARK_TABLES.open);
    if (batch.visits.length) t.add(MARK_TABLES.visit);
    if (batch.seen.length || batch.watermarks.length) t.add(MARK_TABLES.seen);
    return t;
  }

  // Card state is applied nowhere, so it has no table but still has to be sent.
  function hasPending(): boolean {
    return pendingTables().size > 0 || batch.cardState !== null;
  }
}

export type MarkBatch = ReturnType<typeof createMarkBatch>;

/** The batch the app's mark writers append to. */
export const defaultMarkBatch: MarkBatch = createMarkBatch();
export const recordMark = defaultMarkBatch.recordMark;
