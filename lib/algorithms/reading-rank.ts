/**
 * Which article of a story is shown, by the publication's phone reading score
 * and the reader's language. The news server orders its World and country
 * cards with a function of the same name and the same numbers; keep them equal.
 *
 * A story shows its best-scored article in the reader's language when that
 * article scores 50 or more, else its best-scored article in any language. An
 * unscored article counts as 0 and is never a reader-language match.
 *
 * Pure: no imports beyond `baseLang`.
 */

import { baseLang } from './geo-language-priority';

/** A reader-language article scoring at least this outranks every other-language one. */
export const READER_LANGUAGE_FLOOR = 50;

/** Higher wins. `score` null or not finite means unscored. */
export function readingRank(score: number | null | undefined, inReaderLanguage: boolean): number {
    if (!isScore(score)) return 0;
    return (inReaderLanguage && score >= READER_LANGUAGE_FLOOR ? 1000 : 0) + score;
}

function isScore(score: number | null | undefined): score is number {
    return typeof score === 'number' && Number.isFinite(score);
}

export interface ReadingRanked {
    readingScore?: number | null;
    /** The article's language code as stored (`en-gb`, `hi`...). */
    languageCode: string | null;
}

/**
 * Comparator key (negative = `a` first). 0 on equal rank, which includes
 * neither side scored, so the caller's existing keys decide exactly as before.
 * `readerLanguageBase` null means no reader language: the key is the score alone.
 */
export function compareReadingRank(
    a: ReadingRanked,
    b: ReadingRanked,
    readerLanguageBase: string | null,
): number {
    const inLang = (s: ReadingRanked) =>
        readerLanguageBase !== null && baseLang(s.languageCode) === readerLanguageBase;
    return readingRank(b.readingScore, inLang(b)) - readingRank(a.readingScore, inLang(a));
}
