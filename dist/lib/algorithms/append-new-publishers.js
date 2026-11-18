"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.appendNewPublishers = appendNewPublishers;
// A cursor page can repeat a publisher the list already holds; keys must stay unique.
function appendNewPublishers(prev, incoming) {
  const seen = new Set(prev.map(p => p._id));
  const fresh = incoming.filter(p => !seen.has(p._id) && seen.add(p._id));
  return [...prev, ...fresh];
}