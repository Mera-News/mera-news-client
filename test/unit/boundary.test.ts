// The package must load on any JavaScript host: no phone or UI module, nothing outside the package.
//
// Every file under lib/ (tests excluded) is parsed and each import, export-from, require() and
// import() is checked. The negative controls at the bottom run the checker on in-memory sources,
// so a broken checker cannot read as green.

import { readdirSync, readFileSync, statSync } from 'fs';
import { builtinModules } from 'module';
import { dirname, join, relative, resolve, sep } from 'path';
import * as ts from 'typescript';

const ROOT = resolve(__dirname, '../..');
const LIB = join(ROOT, 'lib');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};
const DECLARED = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})]);

const FORBIDDEN_AT_RUNTIME = [
  /^react-native(-|\/|$)/,
  /^@react-native/,
  /^expo(-|\/|$)/,
  /^@expo\//,
  /^@sentry\//,
  /^llama\.rn(\/|$)/,
  /^@dr\.pogodin\//,
  /^@intercom\//,
  /^@react-navigation\//,
  /^@nozbe\/watermelondb\/adapters\/sqlite(\/|$)/,
];
// Types only: erased at build time, so the module never loads.
const ALLOWED_TYPE_ONLY = [/^llama\.rn$/, /^@nozbe\/watermelondb\/adapters\/sqlite(\/|$)/];
const BUILTINS = new Set(builtinModules);
const FORBIDDEN_DIRS = ['components', 'app', 'modules', 'hooks'];

interface Found {
  spec: string;
  typeOnly: boolean;
  line: number;
}

function importsOf(fileName: string, source: string): Found[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const found: Found[] = [];
  const add = (node: ts.Node, spec: ts.Node | undefined, typeOnly: boolean) => {
    const lit = spec && ts.isLiteralTypeNode(spec) ? spec.literal : spec;
    if (lit && ts.isStringLiteralLike(lit)) {
      found.push({ spec: lit.text, typeOnly, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 });
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const named = clause?.namedBindings;
      const allNamedAreTypes =
        !!clause && !clause.name && !!named && ts.isNamedImports(named) && named.elements.length > 0 &&
        named.elements.every((e) => e.isTypeOnly);
      add(node, node.moduleSpecifier, !!clause?.isTypeOnly || allNamedAreTypes);
    } else if (ts.isExportDeclaration(node)) {
      const named = node.exportClause;
      const allNamedAreTypes =
        !!named && ts.isNamedExports(named) && named.elements.length > 0 && named.elements.every((e) => e.isTypeOnly);
      add(node, node.moduleSpecifier, node.isTypeOnly || allNamedAreTypes);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node, node.moduleReference.expression, node.isTypeOnly);
    } else if (ts.isImportTypeNode(node)) {
      add(node, node.argument, true);
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length > 0 &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      add(node, node.arguments[0], false);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function packageName(spec: string): string {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** The file a relative or `@/` specifier points at, or null when no file is there. */
function resolveLocal(fromFile: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? join(ROOT, spec.slice(2)) : resolve(dirname(fromFile), spec);
  for (const candidate of [base, `${base}.ts`, join(base, 'index.ts'), `${base}.json`]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // not there
    }
  }
  return null;
}

/** Why `spec` may not appear in `file` (an absolute path under lib/), or null when it may. */
function problemWith({ spec, typeOnly }: Found, file: string): string | null {
  if (spec.startsWith('.') || spec.startsWith('@/')) {
    const target = resolveLocal(file, spec);
    if (!target) return 'does not resolve to a file in the package';
    const inLib = relative(LIB, target);
    if (inLib.startsWith('..') || inLib.startsWith(sep)) return 'resolves outside lib/';
    const segments = relative(ROOT, target).split(sep);
    const bad = segments.slice(0, -1).find((s) => FORBIDDEN_DIRS.includes(s));
    return bad ? `resolves into ${bad}/` : null;
  }
  if (typeOnly && ALLOWED_TYPE_ONLY.some((re) => re.test(spec))) return null;
  if (!typeOnly && FORBIDDEN_AT_RUNTIME.some((re) => re.test(spec))) return 'a phone or UI module';
  if (spec.startsWith('node:') || BUILTINS.has(packageName(spec))) {
    return file.endsWith(`${sep}generate.ts`) ? null : 'a Node builtin outside generate.ts';
  }
  if (DECLARED.has(packageName(spec))) return null;
  return 'not in dependencies or peerDependencies';
}

/** One message per offending import in `source`, as if it lived at `file`. */
function violationsIn(file: string, source: string): string[] {
  return importsOf(file, source).flatMap((found) => {
    const why = problemWith(found, file);
    return why ? [`${relative(ROOT, file)}:${found.line} '${found.spec}' ${why}`] : [];
  });
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

const files = walk(LIB);

describe('package imports', () => {
  it('checks the whole package', () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it.each(files.map((f) => [relative(ROOT, f), f]))('%s imports nothing outside the package', (_label, file) => {
    expect(violationsIn(file, readFileSync(file, 'utf8'))).toEqual([]);
  });
});

describe('the checker', () => {
  const at = join(LIB, 'database', 'x.ts');

  it('flags a react-native import', () => {
    expect(violationsIn(at, `import { AppState } from 'react-native';`)).toHaveLength(1);
  });

  it('flags a relative import that does not resolve', () => {
    expect(violationsIn(at, `const t = require('../toast-manager');`)).toHaveLength(1);
  });

  it('flags a runtime llama.rn import', () => {
    expect(violationsIn(at, `import Kev from 'llama.rn';`)).toHaveLength(1);
  });

  it('allows a type-only llama.rn import', () => {
    expect(violationsIn(at, `import type { DecisionRequest } from 'llama.rn';`)).toEqual([]);
  });

  it('flags a dynamic import of an expo module', () => {
    expect(violationsIn(at, `const m = import('expo-router');`)).toHaveLength(1);
  });

  it('flags a Node builtin outside generate.ts', () => {
    expect(violationsIn(at, `import { readFileSync } from 'fs';`)).toHaveLength(1);
    expect(violationsIn(join(LIB, 'harnesses', 'generate.ts'), `import { readFileSync } from 'fs';`)).toEqual([]);
  });
});
