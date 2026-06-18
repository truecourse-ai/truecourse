/**
 * Code-side presence detectors for the ForbiddenArtifact comparator.
 *
 * One function per category; each scans the code dir and returns matches
 * the comparator turns into `forbidden.${category}.${pattern}.present`
 * drifts.
 *
 *   - file-glob:    fs walk + minimatch (language-agnostic)
 *   - env-var:      per-language AST scan (process.env / import.meta.env /
 *                   Deno.env.get on JS-family; os.environ / os.getenv on Python)
 *   - dependency:   cross-ecosystem manifest read (npm + Python — see manifests.ts)
 *   - feature-flag: env-var detection, then a textual scan of config files
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Node as SyntaxNode } from 'web-tree-sitter';
import { minimatch } from '../../comparator/minimatch.js';
import { eachParsedSource, type ParsedSource } from '../source-walker.js';
import { collectDependencies } from '../manifests.js';
import { csStringText } from '../shared/cs-nodes.js';
import { loadTcIgnore } from '@truecourse/shared';

export interface ForbiddenMatch {
  filePath: string;
  lineStart?: number;
  lineEnd?: number;
  /** Verbatim slice that matched. */
  snippet?: string;
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.cache', '.truecourse', '__pycache__', '.venv', 'venv']);

// ---------------------------------------------------------------------------
// file-glob detector
// ---------------------------------------------------------------------------

export function detectForbiddenFiles(rootDir: string, pattern: string): ForbiddenMatch[] {
  const out: ForbiddenMatch[] = [];
  const tcIgnore = loadTcIgnore(rootDir);
  const visit = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (tcIgnore.ignores(full)) continue;
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = path.relative(rootDir, full);
      if (minimatch(rel, pattern)) {
        out.push({ filePath: full });
      }
    }
  };
  visit(rootDir);
  return out;
}

// ---------------------------------------------------------------------------
// env-var detector (multi-language)
// ---------------------------------------------------------------------------

export async function detectForbiddenEnvVar(rootDir: string, name: string): Promise<ForbiddenMatch[]> {
  const out: ForbiddenMatch[] = [];
  await eachParsedSource(rootDir, (s) => {
    if (!s.source.includes(name)) return; // cheap pre-filter
    const reads = s.lang === 'python' ? findPyEnvVarReads(s, name)
      : s.lang === 'csharp' ? findCsEnvVarReads(s, name)
      : findJsEnvVarReads(s, name);
    for (const node of reads) {
      out.push({
        filePath: s.filePath,
        lineStart: node.startPosition.row + 1,
        lineEnd: node.endPosition.row + 1,
        snippet: s.source.slice(node.startIndex, Math.min(node.endIndex, node.startIndex + 80)),
      });
    }
  });
  return out;
}

function findJsEnvVarReads(s: ParsedSource, name: string): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  walk(s.tree.rootNode, (node) => {
    if (matchProcessEnv(node, name) || matchImportMetaEnv(node, name) || matchDenoEnvGet(node, name)) {
      out.push(node);
      return false;
    }
    return true;
  });
  return out;
}

/** `process.env.NAME` — a member_expression chain. */
function matchProcessEnv(node: SyntaxNode, name: string): boolean {
  if (node.type !== 'member_expression') return false;
  if (node.childForFieldName('property')?.text !== name) return false;
  const obj = node.childForFieldName('object');
  if (obj?.type !== 'member_expression') return false;
  return obj.childForFieldName('property')?.text === 'env'
    && obj.childForFieldName('object')?.text === 'process';
}

/** `import.meta.env.NAME` */
function matchImportMetaEnv(node: SyntaxNode, name: string): boolean {
  if (node.type !== 'member_expression') return false;
  if (node.childForFieldName('property')?.text !== name) return false;
  const obj = node.childForFieldName('object');
  if (obj?.type !== 'member_expression') return false;
  if (obj.childForFieldName('property')?.text !== 'env') return false;
  return obj.childForFieldName('object')?.text === 'import.meta';
}

/** `Deno.env.get('NAME')` */
function matchDenoEnvGet(node: SyntaxNode, name: string): boolean {
  if (node.type !== 'call_expression') return false;
  const fn = node.childForFieldName('function');
  if (fn?.type !== 'member_expression') return false;
  if (fn.childForFieldName('property')?.text !== 'get') return false;
  const recv = fn.childForFieldName('object');
  if (recv?.type !== 'member_expression') return false;
  if (recv.childForFieldName('property')?.text !== 'env') return false;
  if (recv.childForFieldName('object')?.text !== 'Deno') return false;
  return callHasStringArg(node, name);
}

/**
 * Python env reads: `os.environ.get("NAME")`, `os.getenv("NAME")`,
 * `os.environ["NAME"]`, and the bare `environ[...]` / `getenv(...)`
 * forms from `from os import environ, getenv`.
 */
function findPyEnvVarReads(s: ParsedSource, name: string): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  walk(s.tree.rootNode, (node) => {
    // os.environ["NAME"] / environ["NAME"]
    if (node.type === 'subscript') {
      const value = node.childForFieldName('value');
      if (value && isEnvironAccess(value, s.source) && subscriptIsString(node, s.source, name)) {
        out.push(node);
        return false;
      }
    }
    // os.environ.get("NAME") / os.getenv("NAME") / getenv("NAME") / environ.get("NAME")
    if (node.type === 'call') {
      const fn = node.childForFieldName('function');
      if (fn && isEnvGetterCall(fn, s.source) && pyCallHasStringArg(node, s.source, name)) {
        out.push(node);
        return false;
      }
    }
    return true;
  });
  return out;
}

/** `os.environ` or bare `environ`. */
function isEnvironAccess(node: SyntaxNode, source: string): boolean {
  const text = source.slice(node.startIndex, node.endIndex);
  return text === 'os.environ' || text === 'environ';
}

/** Function expr of `os.environ.get` / `os.getenv` / `getenv` / `environ.get`. */
function isEnvGetterCall(fn: SyntaxNode, source: string): boolean {
  const text = source.slice(fn.startIndex, fn.endIndex);
  return text === 'os.getenv' || text === 'getenv'
    || text === 'os.environ.get' || text === 'environ.get';
}

function callHasStringArg(callNode: SyntaxNode, name: string): boolean {
  const args = callNode.childForFieldName('arguments');
  if (!args) return false;
  for (let i = 0; i < args.namedChildCount; i++) {
    const arg = args.namedChild(i);
    if (arg?.type === 'string' && arg.text.slice(1, -1) === name) return true;
  }
  return false;
}

function pyCallHasStringArg(callNode: SyntaxNode, source: string, name: string): boolean {
  const args = callNode.childForFieldName('arguments');
  if (!args) return false;
  for (let i = 0; i < args.namedChildCount; i++) {
    const arg = args.namedChild(i);
    if (arg?.type === 'string' && pyStringText(arg, source) === name) return true;
  }
  return false;
}

function subscriptIsString(node: SyntaxNode, source: string, name: string): boolean {
  const sub = node.childForFieldName('subscript');
  return !!sub && sub.type === 'string' && pyStringText(sub, source) === name;
}

function pyStringText(node: SyntaxNode, source: string): string {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c?.type === 'string_content') return source.slice(c.startIndex, c.endIndex);
  }
  return source.slice(node.startIndex, node.endIndex).replace(/^[a-zA-Z]*('''|"""|'|")|('''|"""|'|")$/g, '');
}

/**
 * C# env reads: `Environment.GetEnvironmentVariable("NAME")`,
 * `Configuration["NAME"]` / `builder.Configuration["NAME"]`, and
 * `*.Configuration.GetValue<T>("NAME")` (the IConfiguration options pattern).
 */
function findCsEnvVarReads(s: ParsedSource, name: string): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  walk(s.tree.rootNode, (node) => {
    if (node.type === 'invocation_expression') {
      const fn = node.childForFieldName('function');
      if (fn && isCsEnvGetter(fn, s.source) && csCallHasStringArg(node, s.source, name)) {
        out.push(node);
        return false;
      }
    }
    if (node.type === 'element_access_expression') {
      const expr = node.childForFieldName('expression');
      if (expr && isCsConfigReceiver(expr, s.source) && csBracketIsString(node, s.source, name)) {
        out.push(node);
        return false;
      }
    }
    return true;
  });
  return out;
}

/** `Environment.GetEnvironmentVariable` or `*.Configuration.GetValue<…>`. */
function isCsEnvGetter(fn: SyntaxNode, source: string): boolean {
  if (fn.type !== 'member_access_expression') return false;
  const member = fn.childForFieldName('name');
  const recv = fn.childForFieldName('expression');
  if (!member || !recv) return false;
  const memberName = source.slice(member.startIndex, member.endIndex);
  const recvText = source.slice(recv.startIndex, recv.endIndex);
  if (memberName === 'GetEnvironmentVariable' && recvText === 'Environment') return true;
  if (/^GetValue\b/.test(memberName) && /(^|\.)Configuration$/.test(recvText)) return true;
  return false;
}

function isCsConfigReceiver(expr: SyntaxNode, source: string): boolean {
  const text = source.slice(expr.startIndex, expr.endIndex);
  return text === 'Configuration' || /(^|\.)Configuration$/.test(text);
}

function csCallHasStringArg(node: SyntaxNode, source: string, name: string): boolean {
  const args = node.childForFieldName('arguments');
  return !!args && csHasStringLiteral(args, source, name);
}

function csBracketIsString(node: SyntaxNode, source: string, name: string): boolean {
  const sub = node.childForFieldName('subscript') ?? node;
  return csHasStringLiteral(sub, source, name);
}

function csHasStringLiteral(root: SyntaxNode, source: string, name: string): boolean {
  let found = false;
  walk(root, (n) => {
    if (n.type === 'string_literal' && csStringText(n, source) === name) {
      found = true;
      return false;
    }
    return true;
  });
  return found;
}

// ---------------------------------------------------------------------------
// dependency detector (cross-ecosystem)
// ---------------------------------------------------------------------------

export function detectForbiddenDependency(rootDir: string, name: string): ForbiddenMatch[] {
  const out: ForbiddenMatch[] = [];
  for (const dep of collectDependencies(rootDir)) {
    if (dep.name === name) {
      const version = dep.version ? ` ${dep.version}` : '';
      out.push({ filePath: dep.filePath, snippet: `${name}${version} (${dep.field})` });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// feature-flag detector
// ---------------------------------------------------------------------------

export async function detectForbiddenFeatureFlag(rootDir: string, name: string): Promise<ForbiddenMatch[]> {
  const envMatches = await detectForbiddenEnvVar(rootDir, name);
  if (envMatches.length > 0) return envMatches;
  return detectFlagInConfigFiles(rootDir, name);
}

function detectFlagInConfigFiles(rootDir: string, name: string): ForbiddenMatch[] {
  const out: ForbiddenMatch[] = [];
  const CONFIG_EXT = new Set(['.json', '.yaml', '.yml', '.toml', '.env', '.ini', '.cfg']);
  const tcIgnore = loadTcIgnore(rootDir);
  const visit = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (tcIgnore.ignores(full)) continue;
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      const ext = path.extname(entry.name);
      if (!CONFIG_EXT.has(ext)) continue;
      let source: string;
      try {
        source = fs.readFileSync(full, 'utf-8');
      } catch {
        continue;
      }
      const lines = source.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(name)) {
          out.push({ filePath: full, lineStart: i + 1, lineEnd: i + 1, snippet: lines[i].trim().slice(0, 120) });
        }
      }
    }
  };
  visit(rootDir);
  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function walk(node: SyntaxNode, visit: (n: SyntaxNode) => boolean | void): void {
  const recurse = visit(node);
  if (recurse === false) return;
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c) walk(c, visit);
  }
}
