import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { forEachInlineSecret } from './recipe-secrets.js';

export const PreparationQualificationSchema = z.object({
  version: z.literal(1),
  scope: z.literal('instance'),
  binding: z.string().regex(/^[a-f0-9]{64}$/),
  configuration: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().min(1),
  sources: z.array(z.object({
    path: z.string().min(1), start: z.number().int().positive(), end: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/), role: z.enum(['handler', 'query', 'authorization']),
  }).strict()).min(3),
}).strict();
export type PreparationQualification = z.infer<typeof PreparationQualificationSchema>;
type Check = {path: string; server?: string; query?: Record<string, string>; credential?: string; counts: Record<string, number>; totals?: Record<string, number>; qualification?: PreparationQualification};
const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])) : v;
export const observationHash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function observationBinding(check: Check) {
  return observationHash({ path: check.path, server: check.server, query: check.query, credential: check.credential,
    counts: Object.keys(check.counts).sort(), totals: Object.keys(check.totals ?? {}).sort() });
}
export function observationConfiguration(recipe: unknown) {
  const value = JSON.parse(JSON.stringify(recipe));
  // Credential rotation is neutral, as in the recipe fingerprint and hosted bundles.
  forEachInlineSecret(value, holder => { delete holder.value; });
  delete value.preparations;
  if (value.api) delete value.api.seed;
  return observationHash(value);
}
export function observationSource(repoRoot: string, relative: string) {
  const root = fs.realpathSync(repoRoot);
  const file = fs.realpathSync(path.resolve(root, relative));
  const rel = path.relative(root, file);
  if (path.isAbsolute(relative) || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw Error('Observation source escapes repository');
  const body = fs.readFileSync(file, 'utf8');
  return { body, sha256: createHash('sha256').update(body).digest('hex') };
}
export function assertObservationQualification(repoRoot: string, recipe: unknown, check: Check) {
  const parsed = PreparationQualificationSchema.safeParse(check.qualification);
  const refresh = 'Refresh Guard Setup preparations: baseline observation qualification is missing, stale or invalid.';
  if (!parsed.success) throw Error(refresh);
  const q = parsed.data;
  if (q.binding !== observationBinding(check) || q.configuration !== observationConfiguration(recipe)) throw Error(refresh);
  if (!['handler', 'query', 'authorization'].every(role => q.sources.some(s => s.role === role))) throw Error(refresh);
  for (const source of q.sources) {
    let actual;
    try { actual = observationSource(repoRoot, source.path); } catch { throw Error(refresh); }
    if (source.sha256 !== actual.sha256 || source.end < source.start || source.end > actual.body.split('\n').length) throw Error(refresh);
  }
}
