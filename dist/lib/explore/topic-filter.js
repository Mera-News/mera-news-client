"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.EXCLUDED_TOPIC_PATHS = void 0;
exports.effectivePick = effectivePick;
exports.topicLabel = topicLabel;
exports.topicSlug = topicSlug;
exports.visibleTopics = visibleTopics;
// World's topic filter, pure: slugs, labels, and which topics the sheet offers. No RN.

/** Level-1 topics that are not news topics (owner). */
const EXCLUDED_TOPIC_PATHS = exports.EXCLUDED_TOPIC_PATHS = ['/Reference'];

/** '/Arts & Entertainment' -> 'arts_entertainment': the suffix of `explore.topic.<slug>`. */
function topicSlug(path) {
  return path.replace(/^\//, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/** The translated label when the app has one, else the server's. */
function topicLabel(t, topic) {
  const key = `explore.topic.${topicSlug(topic.path)}`;
  // Computed key: no literal to type.
  const out = t(key, {
    defaultValue: ''
  });
  return out && out !== key ? out : topic.label;
}
/** Topics worth offering on this page: not excluded, count above zero, biggest first. */
function visibleTopics(topics, facets) {
  const counts = new Map(facets.map(f => [f.topicId, f.count]));
  return topics.filter(tp => !EXCLUDED_TOPIC_PATHS.includes(tp.path) && (counts.get(tp.id) ?? 0) > 0).map(topic => ({
    topic,
    count: counts.get(topic.id) ?? 0
  })).sort((a, b) => b.count - a.count);
}

/** The pick if this page has stories for it, else null (show all). */
function effectivePick(pick, facets) {
  if (!pick) return null;
  return facets.some(f => f.topicId === pick && f.count > 0) ? pick : null;
}