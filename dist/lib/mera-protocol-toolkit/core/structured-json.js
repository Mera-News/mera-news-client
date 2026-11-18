"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.fitsSchema = fitsSchema;
exports.jsonCandidates = jsonCandidates;
exports.readStructured = readStructured;
// Structured output for on-device flows: the JSON Schema subset every engine
// takes (Apple guided generation, Nano's JSON-in-text, Qwen's llama.rn
// json_schema grammar), and the tolerant reader that turns a reply into a value.
// Pure, import-free: the harness reads replies with the same code.

/**
 * Every balanced JSON object or array in `text`, in order of where it starts.
 * Brackets inside strings do not count, so prose, code fences or a trailing
 * remark around the JSON are skipped. Candidates only: they may not parse.
 */
function jsonCandidates(text, open) {
  const close = open === '{' ? '}' : ']';
  const out = [];
  for (let start = text.indexOf(open); start !== -1; start = text.indexOf(open, start + 1)) {
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inString) {
        if (c === '\\') i++;else if (c === '"') inString = false;
      } else if (c === '"') {
        inString = true;
      } else if (c === '{' || c === '[') {
        depth++;
      } else if (c === '}' || c === ']') {
        depth--;
        if (depth === 0) {
          if (c === close) out.push(text.slice(start, i + 1));
          break;
        }
      }
    }
  }
  return out;
}

/**
 * Whether `value` fits `schema`. Arrays longer than `maxItems` are cut to it in
 * place (a model that offers one option too many is still usable); everything
 * else must already fit.
 */
function fitsSchema(value, schema) {
  switch (schema.type) {
    case 'object':
      {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
        const obj = value;
        if ((schema.required ?? []).some(k => obj[k] === undefined)) return false;
        return Object.entries(schema.properties).every(([k, s]) => obj[k] === undefined || fitsSchema(obj[k], s));
      }
    case 'array':
      {
        if (!Array.isArray(value)) return false;
        if (schema.maxItems !== undefined && value.length > schema.maxItems) value.length = schema.maxItems;
        if (schema.minItems !== undefined && value.length < schema.minItems) return false;
        return value.every(v => fitsSchema(v, schema.items));
      }
    case 'string':
      return typeof value === 'string' && (!schema.enum || schema.enum.includes(value));
    case 'integer':
      return Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
  }
}

/**
 * The first JSON value in `text` that fits `schema`, or undefined. The whole
 * text is tried first (the common case), then every balanced candidate.
 */
function readStructured(text, schema) {
  const tries = [text.trim()];
  if (schema.type === 'object' || schema.type === 'array') {
    tries.push(...jsonCandidates(text, schema.type === 'object' ? '{' : '['));
  }
  for (const t of tries) {
    let value;
    try {
      value = JSON.parse(t);
    } catch {
      continue;
    }
    if (fitsSchema(value, schema)) return value;
  }
  return undefined;
}