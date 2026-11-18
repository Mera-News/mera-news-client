"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.sanitizeSnapshots = void 0;
/**
 * A lean, card-renderable snapshot of one member article, remembered so the
 * timeline can render locally-discovered members without a server round trip.
 * `pubDateMs` drives the strict newest-first ordering; the rest degrade
 * gracefully when absent.
 */

/** Coerce the persisted member-snapshot JSON column into a clean array. */
const sanitizeSnapshots = raw => Array.isArray(raw) ? raw.filter(x => !!x && typeof x === 'object').map(x => ({
  articleId: String(x.articleId ?? ''),
  title: typeof x.title === 'string' ? x.title : '',
  titleOriginal: typeof x.titleOriginal === 'string' && x.titleOriginal ? x.titleOriginal : undefined,
  pubDateMs: Number(x.pubDateMs) || 0,
  imageUrl: typeof x.imageUrl === 'string' ? x.imageUrl : undefined,
  publicationName: typeof x.publicationName === 'string' ? x.publicationName : undefined,
  languageCode: typeof x.languageCode === 'string' ? x.languageCode : undefined,
  countryCode: typeof x.countryCode === 'string' ? x.countryCode : undefined,
  storyKey: typeof x.storyKey === 'string' && x.storyKey ? x.storyKey : undefined
})).filter(x => x.articleId.length > 0) : [];
exports.sanitizeSnapshots = sanitizeSnapshots;