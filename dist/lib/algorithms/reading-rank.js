"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.READER_LANGUAGE_FLOOR = void 0;
exports.compareReadingRank = compareReadingRank;
exports.readingRank = readingRank;
var _geoLanguagePriority = require("./geo-language-priority");
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

/** A reader-language article scoring at least this outranks every other-language one. */
const READER_LANGUAGE_FLOOR = exports.READER_LANGUAGE_FLOOR = 50;

/** Higher wins. `score` null or not finite means unscored. */
function readingRank(score, inReaderLanguage) {
  if (!isScore(score)) return 0;
  return (inReaderLanguage && score >= READER_LANGUAGE_FLOOR ? 1000 : 0) + score;
}
function isScore(score) {
  return typeof score === 'number' && Number.isFinite(score);
}
/**
 * Comparator key (negative = `a` first). 0 on equal rank, which includes
 * neither side scored, so the caller's existing keys decide exactly as before.
 * `readerLanguageBase` null means no reader language: the key is the score alone.
 */
function compareReadingRank(a, b, readerLanguageBase) {
  const inLang = s => readerLanguageBase !== null && (0, _geoLanguagePriority.baseLang)(s.languageCode) === readerLanguageBase;
  return readingRank(b.readingScore, inLang(b)) - readingRank(a.readingScore, inLang(a));
}