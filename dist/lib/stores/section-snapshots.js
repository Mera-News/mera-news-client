"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.loadSectionSnapshots = loadSectionSnapshots;
var _topicService = require("../database/services/topic-service");
var _factService = require("../database/services/fact-service");
var _locationService = require("../database/services/location-service");
// section-snapshots — the small RN-coupled loader that reads the persona-v3
// tables (topics / facts / locations) into the plain Map snapshots the pure
// fact-ownership cores consume (`resolveOwnership` in feed-select/ownership,
// the fact-rows feed selector, and the per-fact scoring batcher).
//
// Moved here when the old `feed-sections-selector` was deleted;
// this is the one piece that genuinely needed a home (it touches the DB, so it
// can't live in a pure selector module).

/**
 * Read the persona-v3 tables into the plain Map snapshots the ownership cores
 * consume. Small tables (topics/facts/locations) — one shot per rebuild.
 */
async function loadSectionSnapshots() {
  const [topicRows, factRows, locationRows, topicCount] = await Promise.all([(0, _topicService.getActiveTopicSnapshots)(), (0, _factService.getFactSectionSnapshots)(), (0, _locationService.getAll)(), (0, _topicService.countAllTopics)()]);
  const topics = new Map();
  for (const t of topicRows) {
    topics.set(t.id, {
      factId: t.factId,
      weight: t.weight,
      highPriority: t.highPriority,
      status: 'active'
    });
  }
  const facts = new Map();
  const factStatements = new Map();
  for (const f of factRows) {
    facts.set(f.id, {
      weight: f.weight,
      createdAtMs: f.createdAtMs,
      // Display title = generated section_title when present, else the statement.
      statement: f.sectionTitle ?? f.statement
    });
    factStatements.set(f.id, f.statement);
  }
  const locations = new Map();
  for (const l of locationRows) {
    locations.set(l.id, {
      city: l.city,
      region: l.region,
      countryCode: l.countryCode,
      country: null,
      weight: l.weight
    });
  }
  return {
    topics,
    facts,
    locations,
    factStatements,
    hasTopics: topicCount > 0
  };
}