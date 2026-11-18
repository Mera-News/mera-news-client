"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.parsePersonaSummaryOutput = parsePersonaSummaryOutput;
// news-harness — persona-summary strict-JSON parser (PURE, RN-free).

/**
 * Extract the first top-level JSON array from raw model output. Tolerates
 * markdown code fences and leading/trailing prose the model sometimes adds.
 * Throws when no array can be recovered (the handler treats this as "keep the
 * previous strings").
 */
function extractJsonArray(raw) {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('persona-summary: empty model output');

  // Fast path — the whole thing is already a JSON array.
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // fall through to bracket extraction
  }
  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('persona-summary: no JSON array in model output');
  }
  const slice = trimmed.slice(start, end + 1);
  const parsed = JSON.parse(slice); // throws on malformed JSON — intended
  if (!Array.isArray(parsed)) {
    throw new Error('persona-summary: extracted value is not an array');
  }
  return parsed;
}

/**
 * Parse model output into drafts. Skips malformed entries (missing/blank text)
 * but throws when the output is not a JSON array at all, so the handler can
 * distinguish "model produced garbage" (keep old strings) from "model produced
 * a valid but partly-empty array" (use what parsed).
 */
function parsePersonaSummaryOutput(raw) {
  const arr = extractJsonArray(raw);
  const drafts = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const obj = item;
    const text = typeof obj.text === 'string' ? obj.text.trim() : '';
    if (!text) continue;
    const rawRefs = Array.isArray(obj.facts) ? obj.facts : Array.isArray(obj.factRefs) ? obj.factRefs : [];
    const factRefs = rawRefs.map(n => typeof n === 'number' ? n : Number(n)).filter(n => Number.isInteger(n) && n > 0);
    drafts.push({
      text,
      factRefs
    });
  }
  return drafts;
}