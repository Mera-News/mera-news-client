"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.createThinkStripper = createThinkStripper;
exports.stripThinkTags = stripThinkTags;
// think-strip — remove reasoning tags from assistant text before it is shown
// or saved.
//
// Friction this removes: a reply rendered "Your parents live in Neerja Nagar,
// Bhopal. </think>". `stripLeakedReasoning` (reasoning-leak.ts) is the wrong
// tool for chat: it drops everything up to the LAST closer, which on that
// string deletes the whole answer. Here a paired block goes whole and a stray
// tag goes alone, keeping the text around it.
//
// PURE, no imports, so the transcript builder and the thread deriver can share
// it with both chat engines.

const TAG_RE = /<\s*(\/?)\s*think\s*>/gi;
/** A tail that could still become a tag once the next chunk lands. */
const PARTIAL_RE = /^<\s*\/?\s*(?:t(?:h(?:i(?:n(?:k\s*)?)?)?)?)?$/i;
/**
 * A streaming stripper. The concatenation of every `push` result plus `flush`
 * equals `stripThinkTags` of the whole text, at any chunk split.
 *
 * Rules: a `<think>...</think>` block is removed with its content, nested
 * blocks included. A stray closer is removed as a tag only. An opener that is
 * never closed is removed as a tag only and its text is released at `flush`:
 * losing the whole answer to a malformed tag is worse than showing it late.
 */
function createThinkStripper() {
  let pending = '';
  let depth = 0;
  let held = '';
  const route = text => {
    if (depth > 0) {
      held += text;
      return '';
    }
    return text;
  };
  const run = final => {
    let out = '';
    let last = 0;
    TAG_RE.lastIndex = 0;
    let m;
    while ((m = TAG_RE.exec(pending)) !== null) {
      out += route(pending.slice(last, m.index));
      if (m[1]) {
        if (depth > 0) {
          depth--;
          if (depth === 0) held = '';
        }
      } else {
        depth++;
      }
      last = TAG_RE.lastIndex;
    }
    let rest = pending.slice(last);
    pending = '';
    if (!final) {
      const lt = rest.lastIndexOf('<');
      if (lt !== -1 && PARTIAL_RE.test(rest.slice(lt))) {
        pending = rest.slice(lt);
        rest = rest.slice(0, lt);
      }
    }
    out += route(rest);
    if (final && depth > 0) {
      out += held;
      held = '';
      depth = 0;
    }
    return out;
  };
  return {
    push(chunk) {
      if (!chunk) return '';
      pending += chunk;
      return run(false);
    },
    flush() {
      return run(true);
    }
  };
}

/** Whole-text form of {@link createThinkStripper}. */
function stripThinkTags(text) {
  if (!text || !/think/i.test(text)) return text;
  const s = createThinkStripper();
  return s.push(text) + s.flush();
}