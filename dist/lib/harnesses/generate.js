"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.HarnessGenerationError = exports.HARNESSES_ROOT = void 0;
exports.generateSlotsModuleText = generateSlotsModuleText;
exports.slotsFileFor = void 0;
var fs = _interopRequireWildcard(require("node:fs"));
var path = _interopRequireWildcard(require("node:path"));
var _generate = require("../mera-harness/skills/generate");
var _slotText = require("./slot-text");
var _template = require("./template");
var cache;
function _interopRequireWildcard(e, t) { if (!t && e && e.__esModule) return e; var r, c, a = Object.defineProperty, n = { __proto__: null, default: e }; if (Object(e) !== e) return n; if (cache || "function" != typeof WeakMap || (cache = new WeakMap()), cache) { if (cache.has(e)) return cache.get(e); cache.set(e, n); } for (c in e) "default" !== c && {}.hasOwnProperty.call(e, c) && ((r = a && Object.getOwnPropertyDescriptor(e, c)) && (r.get || r.set) ? a(n, c, r) : n[c] = e[c]); return n; }
/**
 * harness:generate. Compiles every harness folder's prompt slots (`*.md`) into slots.generated.ts,
 * and the cloud base's persona skills (`cloud-base/skills/**.md`) into
 * lib/mera-harness/skills/index.generated.ts. Metro cannot read a directory or a .md at runtime,
 * so the app imports the generated modules.
 *
 *   npm run harness:generate             # write
 *   npm run harness:generate -- --check  # verify, exit 1 on drift
 *
 * A slot file is the prompt text byte for byte, ending in exactly one newline that is not part of
 * it. It may open with one `<!-- ... -->` note for readers, which is dropped. Inside, `{{> id}}`
 * includes another slot of the same folder (expanded here) and `{{name}}`, `{{#if name}}`,
 * `{{#unless name}}` are filled at runtime by template.ts.
 *
 * An implementation folder holds only harness.json plus overrides: a slot file at the same path as
 * one in its base, with different text. Its generated map carries just the slots whose expanded
 * text differs from the base, so a base fragment it overrides reaches every slot that includes it.
 */

const HARNESSES_ROOT = exports.HARNESSES_ROOT = __dirname;
const slotsFileFor = root => path.join(root, 'slots.generated.ts');
/** The persona skills: compiled by the skills generator, not as slots. */
exports.slotsFileFor = slotsFileFor;
const SKILLS_DIR = 'skills';
class HarnessGenerationError extends Error {
  constructor(problems) {
    super(`${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
    this.problems = problems;
    this.name = 'HarnessGenerationError';
  }
}
exports.HarnessGenerationError = HarnessGenerationError;
function walk(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, rel), {
    withFileTypes: true
  }).sort((a, b) => a.name < b.name ? -1 : 1)) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (!rel && e.name === SKILLS_DIR) continue;
      out.push(...walk(dir, r));
    } else if (e.name.endsWith('.md')) out.push(r);
  }
  return out;
}
function readFolders(root, problems) {
  const folders = [];
  for (const name of fs.readdirSync(root).sort()) {
    const dir = path.join(root, name);
    const json = path.join(dir, 'harness.json');
    if (!fs.statSync(dir).isDirectory() || !fs.existsSync(json)) continue;
    const f = {
      name,
      extends: JSON.parse(fs.readFileSync(json, 'utf8')).extends ?? null,
      slots: new Map(),
      files: new Map()
    };
    for (const rel of walk(dir)) {
      const file = path.join(name, rel);
      const text = (0, _slotText.slotText)(fs.readFileSync(path.join(dir, rel), 'utf8'));
      if (text === null) {
        problems.push(`${file}: must end with one newline (it is not part of the prompt)`);
        continue;
      }
      const id = rel.replace(/\.md$/, '');
      if (!/^[a-z0-9][a-z0-9/-]*$/.test(id)) problems.push(`${file}: slot ids are lowercase kebab-case paths`);
      f.slots.set(id, text);
      f.files.set(id, file);
    }
    folders.push(f);
  }
  return folders;
}

/** Every slot the folder sees: its base's, overlaid by each folder down the chain. */
function overlay(folder, byName) {
  const chain = [];
  for (let at = folder; at; at = at.extends ? byName.get(at.extends) : undefined) {
    if (chain.includes(at)) break;
    chain.unshift(at);
  }
  const out = new Map();
  for (const f of chain) for (const [id, text] of f.slots) out.set(id, text);
  return out;
}
function expandAll(name, slots, problems) {
  const done = new Map();
  const expand = (id, stack) => {
    const hit = done.get(id);
    if (hit !== undefined) return hit;
    if (stack.includes(id)) {
      problems.push(`${name}: include cycle ${[...stack, id].join(' -> ')}`);
      return '';
    }
    const text = slots.get(id) ?? '';
    const out = text.replace(_slotText.INCLUDE, (_m, target) => {
      if (!slots.has(target)) {
        problems.push(`${name}/${id}: includes "${target}", which is not a slot of this folder`);
        return '';
      }
      return expand(target, [...stack, id]);
    });
    done.set(id, out);
    return out;
  };
  for (const id of slots.keys()) {
    const out = expand(id, []);
    if (out.includes('{{>')) problems.push(`${name}/${id}: malformed include (write {{> id}} with one space)`);
    try {
      (0, _template.parseTemplate)(out);
    } catch (e) {
      problems.push(`${name}/${id}: ${e.message}`);
    }
  }
  return done;
}
const constName = folder => `${folder.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_SLOTS`;
const typeName = folder => folder.replace(/(^|[^a-zA-Z0-9]+)([a-zA-Z0-9])/g, (_m, _s, c) => c.toUpperCase()) + 'Slot';

/** The whole slot pipeline, in memory: what the freshness test and the CLI both call. */
function generateSlotsModuleText(root = HARNESSES_ROOT) {
  const problems = [];
  const folders = readFolders(root, problems);
  const byName = new Map(folders.map(f => [f.name, f]));

  // No two slot files anywhere hold the same bytes: shared text is one fragment, included.
  const seen = new Map();
  for (const f of folders) for (const [id, text] of f.slots) {
    const other = seen.get(text);
    if (other) problems.push(`${f.files.get(id)}: same text as ${other}; include one fragment instead`);else seen.set(text, f.files.get(id) ?? id);
  }

  // Each slot is one const, written as its own text with includes as references to other consts,
  // so a fragment shared by ten prompts sits in the bundle once.
  const L = ['// GENERATED by lib/harnesses/generate.ts from lib/harnesses/*/**.md. Do not edit.', '// Run `npm run harness:generate` after changing a slot. No imports: the news harness loads it.', ''];
  const registry = [];
  /** Cloud base slot -> the cloud base slots that include it directly. */
  const includedBy = new Map();
  /** Folder -> slot id -> the const holding its text as that folder sees it. */
  const resolved = new Map();
  const depth = f => {
    let d = 0;
    for (let at = f; at.extends && byName.has(at.extends) && d < folders.length; at = byName.get(at.extends)) d++;
    return d;
  };
  let n = 0;
  for (const f of [...folders].sort((x, y) => depth(x) - depth(y) || (x.name < y.name ? -1 : 1))) {
    if (f.extends !== null && !byName.has(f.extends)) {
      problems.push(`${f.name}: extends "${f.extends}", which is not a folder`);
      continue;
    }
    const isBase = f.extends === null;
    const view = overlay(f, byName);
    if (f.name === 'cloud-base') for (const [id, raw] of view) for (const m of raw.matchAll(_slotText.INCLUDE)) includedBy.set(m[1], (includedBy.get(m[1]) ?? new Set()).add(id));
    const expanded = expandAll(f.name, view, problems);
    const parentNames = isBase ? new Map() : resolved.get(f.extends ?? '') ?? new Map();
    let own;
    if (isBase) own = [...expanded.keys()];else {
      const parentView = overlay(byName.get(f.extends ?? ''), byName);
      for (const [id, text] of f.slots) {
        if (!parentView.has(id)) problems.push(`${f.files.get(id)}: overrides no slot of "${f.extends}"`);else if (parentView.get(id) === text) problems.push(`${f.files.get(id)}: equals the slot it overrides; delete it`);
      }
      const parentExpanded = expandAll(`${f.name} (parent)`, parentView, []);
      own = [...expanded].filter(([id, text]) => parentExpanded.get(id) !== text).map(([id]) => id);
    }
    own.sort();
    const names = new Map(parentNames);
    for (const id of own) names.set(id, `s${n++}`);
    // Emit in dependency order: a const only references consts above it.
    const emitted = new Set();
    const emit = (id, stack) => {
      if (emitted.has(id) || !own.includes(id) || stack.includes(id)) return;
      const parts = [];
      let at = 0;
      const raw = view.get(id) ?? '';
      for (const m of raw.matchAll(_slotText.INCLUDE)) {
        const i = m.index ?? 0;
        if (i > at) parts.push(JSON.stringify(raw.slice(at, i)));
        emit(m[1], [...stack, id]);
        parts.push(names.get(m[1]) ?? '""');
        at = i + m[0].length;
      }
      if (at < raw.length || parts.length === 0) parts.push(JSON.stringify(raw.slice(at)));
      L.push(`const ${names.get(id)} = ${parts.join(' + ')};`);
      emitted.add(id);
    };
    if (own.length) L.push(`// ${f.name}`);
    for (const id of own) emit(id, []);
    if (own.length) L.push('');
    resolved.set(f.name, names);
    if (isBase && own.length === 0) continue;
    if (isBase) {
      L.push(`export type ${typeName(f.name)} =`);
      for (const id of own) L.push(`  | ${JSON.stringify(id)}`);
      L.push('  ;', '');
      L.push(`export const ${constName(f.name)}: Record<${typeName(f.name)}, string> = {`);
    } else {
      L.push(`/** ${f.name}: only the slots whose text differs from its base. */`);
      L.push(`export const ${constName(f.name)}: Record<string, string> = {`);
    }
    for (const id of own) L.push(`  ${JSON.stringify(id)}: ${names.get(id)},`);
    L.push('};', '');
    registry.push(`  ${JSON.stringify(f.name)}: ${constName(f.name)},`);
  }
  L.push('/** Cloud base slot -> the cloud base slots that include it directly: an override of an included slot would not reach them. */');
  L.push('export const CLOUD_BASE_INCLUDED_BY: Record<string, string[]> = {');
  for (const id of [...includedBy.keys()].sort()) L.push(`  ${JSON.stringify(id)}: ${JSON.stringify([...(includedBy.get(id) ?? [])].sort())},`);
  L.push('};', '');
  L.push('/** Folder -> its slots (a base: all of them; an implementation: its overrides only). */');
  L.push('export const HARNESS_SLOTS: Record<string, Record<string, string>> = {', ...registry.sort(), '};', '');
  if (problems.length) throw new HarnessGenerationError(problems);
  return L.join('\n');
}
function main() {
  const check = process.argv.includes('--check');
  const outputs = [[slotsFileFor(HARNESSES_ROOT), () => generateSlotsModuleText()], [(0, _generate.outFileFor)(_generate.SKILLS_ROOT), () => (0, _generate.generateModuleText)()]];
  let stale = false;
  for (const [file, generate] of outputs) {
    let out;
    try {
      out = generate();
    } catch (e) {
      const problems = e.problems;
      if (!problems) throw e;
      console.error(`\n${problems.length} problem(s):\n`);
      for (const p of problems) console.error(`  ${p}`);
      process.exit(1);
    }
    const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    const rel = path.relative(process.cwd(), file);
    if (check) {
      if (existing !== out) {
        stale = true;
        console.error(`${rel} is stale. Run: npm run harness:generate`);
        console.error(`  first difference at ${existing === null ? 'file is missing' : (0, _generate.firstDifference)(existing, out)}`);
      } else console.log(`${rel} is up to date.`);
    } else {
      if (existing !== out) fs.writeFileSync(file, out, 'utf8');
      console.log(`${rel}: ${out.length} bytes${existing === out ? ' [unchanged]' : ''}`);
    }
  }
  if (stale) process.exit(1);
}

// Only when run as a script. An importing test must not trip process.exit.
if (require.main === module) main();