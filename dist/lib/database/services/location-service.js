"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.deleteLocation = deleteLocation;
exports.getAll = getAll;
exports.observeAll = observeAll;
exports.setPinnedForWeather = setPinnedForWeather;
exports.setRole = setRole;
exports.setWeight = setWeight;
exports.upsertLocation = upsertLocation;
var _watermelondb = require("@nozbe/watermelondb");
var _index = _interopRequireDefault(require("../index"));
var _normalizeKey = require("../../algorithms/normalize-key");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Location Service — WatermelonDB adapter for persona-v3 `locations`.
//
// Thin RN-coupled surface. Locations never leave the device (privacy-lean
// retrieval) — the scoring engine reads them for geo matching.

const locationsCollection = _index.default.get('locations');
/**
 * Creates a location, deduping on normalized (city, country_code, role). An
 * existing match is updated in place (weight/region/valid_until/source fact
 * refreshed) instead of duplicated. Returns the created-or-updated record.
 */
async function upsertLocation(input) {
  const candidates = await locationsCollection.query(_watermelondb.Q.where('country_code', input.countryCode)).fetch();
  const existing = candidates.find(l => (0, _normalizeKey.normalizeKeyOrEmpty)(l.city) === (0, _normalizeKey.normalizeKeyOrEmpty)(input.city) && l.role === input.role);
  return _index.default.write(async () => {
    const now = new Date();
    if (existing) {
      await existing.update(l => {
        if (input.region !== undefined) l.region = input.region ?? null;
        if (input.weight !== undefined) l.weight = input.weight;
        if (input.validUntil !== undefined) l.validUntil = input.validUntil ?? null;
        if (input.sourceFactId !== undefined) l.sourceFactId = input.sourceFactId ?? null;
        l.updatedAt = now;
      });
      return existing;
    }
    return locationsCollection.create(l => {
      l.city = input.city ?? null;
      l.region = input.region ?? null;
      l.countryCode = input.countryCode;
      l.role = input.role;
      l.weight = input.weight ?? 0.5;
      l.validUntil = input.validUntil ?? null;
      l.pinnedForWeather = input.pinnedForWeather ?? false;
      l.provenance = input.provenance ?? 'user';
      l.sourceFactId = input.sourceFactId ?? null;
      l.createdAt = now;
      l.updatedAt = now;
    });
  });
}

/** All locations, weight desc (the canonical ordering). */
async function getAll() {
  return locationsCollection.query(_watermelondb.Q.sortBy('weight', _watermelondb.Q.desc)).fetch();
}

/** Reactive query of all locations, weight desc. */
function observeAll() {
  return locationsCollection.query(_watermelondb.Q.sortBy('weight', _watermelondb.Q.desc)).observe();
}
async function setWeight(locationId, weight) {
  const clamped = Math.max(0, Math.min(1, weight));
  const record = await locationsCollection.find(locationId);
  await _index.default.write(async () => {
    await record.update(l => {
      l.weight = clamped;
      l.updatedAt = new Date();
    });
  });
}

/**
 * Pins exactly one location for the (future) weather widget — unpins any
 * currently-pinned rows in the same write.
 */
async function setPinnedForWeather(locationId) {
  const target = await locationsCollection.find(locationId);
  const pinned = await locationsCollection.query(_watermelondb.Q.where('pinned_for_weather', true)).fetch();
  await _index.default.write(async () => {
    const now = new Date();
    const batch = pinned.filter(l => l.id !== locationId).map(l => l.prepareUpdate(r => {
      r.pinnedForWeather = false;
      r.updatedAt = now;
    }));
    batch.push(target.prepareUpdate(r => {
      r.pinnedForWeather = true;
      r.updatedAt = now;
    }));
    await _index.default.batch(batch);
  });
}

/**
 * Relabels a place (Places ••• > Relabel). (city, country, role) stays unique:
 * when the new role already has a twin for the same place, this row goes and
 * the twin stays, taking over the weather pin if this row held it. Not a
 * change-log row (owner: unlogged relabel).
 */
async function setRole(locationId, role) {
  const record = await locationsCollection.find(locationId);
  if (record.role === role) return;
  const twin = (await locationsCollection.query(_watermelondb.Q.where('country_code', record.countryCode)).fetch()).find(l => l.id !== locationId && l.role === role && l.countryCode === record.countryCode && (0, _normalizeKey.normalizeKeyOrEmpty)(l.city) === (0, _normalizeKey.normalizeKeyOrEmpty)(record.city));
  await _index.default.write(async () => {
    const now = new Date();
    if (!twin) {
      await record.update(l => {
        l.role = role;
        l.updatedAt = now;
      });
      return;
    }
    const ops = [record.prepareDestroyPermanently()];
    if (record.pinnedForWeather && !twin.pinnedForWeather) {
      ops.push(twin.prepareUpdate(l => {
        l.pinnedForWeather = true;
        l.updatedAt = now;
      }));
    }
    await _index.default.batch(ops);
  });
}
async function deleteLocation(locationId) {
  const record = await locationsCollection.find(locationId);
  await _index.default.write(async () => {
    await record.destroyPermanently();
  });
}