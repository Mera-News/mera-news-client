"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.topicsFromReply = topicsFromReply;
/** The usable topics in a reply that fit `topicGenSchema`: trimmed, non-empty strings, at most 20. */
function topicsFromReply(reply) {
  const items = Array.isArray(reply.topics) ? reply.topics : [];
  return items.filter(item => typeof item === 'string' && item.trim().length > 0).map(s => s.trim()).slice(0, 20);
}