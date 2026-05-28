/**
 * Entity extractor — enumerates domain entities + fields from DECLARATIVE
 * schema sources, where "what entities exist" is unambiguous. v1 reads Prisma
 * schema (`model X { … }`); the shape is intentionally ORM-schema-only because
 * loose TS interfaces / dataclasses aren't reliably distinguishable from any
 * other object type (that would be a false-positive farm).
 *
 * Scalar Prisma types map to the `.tc` field type vocabulary; relation/list
 * fields (another model, `Type[]`) are skipped — they're edges, not columns.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { SourceLocation } from '../../types/index.js';
import { loadTcIgnore } from '@truecourse/shared';

export type EntityFieldType = 'uuid' | 'iso-8601' | 'string' | 'integer' | 'number' | 'boolean';

export interface ExtractedEntityField {
  name: string;
  type: EntityFieldType;
  unique?: boolean;
  default?: string | number | boolean;
}

export interface ExtractedEntity {
  name: string;
  fields: ExtractedEntityField[];
  source: SourceLocation;
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'coverage',
  '.cache', '.truecourse', '__pycache__', '.venv', 'venv',
]);

export async function extractEntitiesFromDir(rootDir: string): Promise<ExtractedEntity[]> {
  const tcIgnore = loadTcIgnore(rootDir);
  const out: ExtractedEntity[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (tcIgnore.ignores(full)) continue;
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name.endsWith('.prisma')) {
        out.push(...parsePrismaModels(full, fs.readFileSync(full, 'utf-8')));
      }
    }
  };
  walk(rootDir);
  return out;
}

// ---------------------------------------------------------------------------
// Prisma schema parsing (line-oriented — the grammar is regular enough)
// ---------------------------------------------------------------------------

const SCALAR: Record<string, EntityFieldType> = {
  String: 'string',
  Int: 'integer',
  BigInt: 'integer',
  Float: 'number',
  Decimal: 'number',
  Boolean: 'boolean',
  DateTime: 'iso-8601',
};

function parsePrismaModels(filePath: string, source: string): ExtractedEntity[] {
  const lines = source.split('\n');
  const out: ExtractedEntity[] = [];
  let current: { name: string; startLine: number; fields: ExtractedEntityField[] } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!current) {
      const m = /^model\s+([A-Za-z_]\w*)\s*\{/.exec(line);
      if (m) current = { name: m[1], startLine: i + 1, fields: [] };
      continue;
    }
    if (line === '}') {
      out.push({
        name: current.name,
        fields: current.fields,
        source: { filePath, lineStart: current.startLine, lineEnd: i + 1 },
      });
      current = null;
      continue;
    }
    const field = parsePrismaField(line);
    if (field) current.fields.push(field);
  }
  return out;
}

function parsePrismaField(line: string): ExtractedEntityField | null {
  if (!line || line.startsWith('//') || line.startsWith('@@')) return null;
  const parts = line.split(/\s+/);
  if (parts.length < 2) return null;
  const name = parts[0];
  let rawType = parts[1];
  if (!/^[A-Za-z_]\w*$/.test(name)) return null;

  // Strip optional `?`; list types (`Type[]`) are relations/arrays — skip.
  if (rawType.endsWith('[]')) return null;
  if (rawType.endsWith('?')) rawType = rawType.slice(0, -1);

  const attrs = parts.slice(2).join(' ');
  let type = SCALAR[rawType];
  if (!type) {
    // Non-scalar (relation to another model, or a Prisma enum) — not a column
    // shape we can faithfully render, so skip.
    return null;
  }
  // uuid/cuid id default ⇒ format uuid.
  if (type === 'string' && /@default\((uuid|cuid)\(\)\)/.test(attrs)) type = 'uuid';

  const field: ExtractedEntityField = { name, type };
  if (/@unique\b/.test(attrs) || /@id\b/.test(attrs)) field.unique = true;
  const def = parseDefault(attrs);
  if (def !== undefined) field.default = def;
  return field;
}

function parseDefault(attrs: string): string | number | boolean | undefined {
  const m = /@default\(([^)]*)\)/.exec(attrs);
  if (!m) return undefined;
  const raw = m[1].trim();
  if (/^(uuid|cuid|now|autoincrement)\(\)$/.test(raw)) return undefined; // function default, not a literal
  if (/^".*"$/.test(raw)) return raw.slice(1, -1);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return undefined; // enum member / expression — skip
}
