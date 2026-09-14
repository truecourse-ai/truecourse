import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { observationSource, observationHash, observationConfiguration, type Recipe } from '@truecourse/guard-runner';

/** Small structural briefing; secret values are redacted before any source is exposed. */
export function preparationContext(repoRoot: string, recipe: Recipe, redact: (s: string) => string) {
  const candidates = new Set(['package.json', 'tsconfig.json']);
  for (const server of [recipe.api, recipe.web, ...Object.values(recipe.api?.servers ?? {})]) {
    if (server && 'app' in server && server.app) {
      candidates.add(`${server.app}/package.json`); candidates.add(`${server.app}/tsconfig.json`);
    }
  }
  if (recipe.api?.seed?.script) candidates.add(recipe.api.seed.script);
  const catalogFile = path.join(repoRoot, '.truecourse/guard/interfaces.json');
  const routes: {path: string; title?: string}[] = [];
  let omittedRoutes = 0;
  let routeBytes = 0;
  if (fs.existsSync(catalogFile)) {
    const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
    for (const entry of catalog.interfaces ?? []) {
      if (entry.type !== 'api' || entry.entry?.method !== 'GET' || typeof entry.entry?.path !== 'string') continue;
      const route = {path: redact(entry.entry.path), ...(typeof entry.title === 'string' ? {title: redact(entry.title)} : {})};
      const bytes = Buffer.byteLength(JSON.stringify(route));
      if (routes.length >= 80 || routeBytes + bytes > 8000) { omittedRoutes++; continue; }
      routeBytes += bytes;
      routes.push(route);
    }
  }
  let remaining = 24000;
  const files: {path: string; sha256: string; content: string; omitted: boolean}[] = [];
  for (const relative of candidates) {
    if (!fs.existsSync(path.resolve(repoRoot, relative))) continue;
    const source = observationSource(repoRoot, relative);
    const safe = redact(source.body);
    const included: string[] = [];
    let bytes = 0;
    for (const char of safe) { const size = Buffer.byteLength(char); if (bytes + size > remaining) break; included.push(char); bytes += size; }
    remaining -= bytes;
    files.push({ path: relative, sha256: source.sha256, content: included.join(''), omitted: bytes < Buffer.byteLength(safe) });
  }
  let executor: string;
  try { const req = createRequire(path.join(path.resolve(repoRoot), 'package.json')); req.resolve('tsx/cli'); executor = 'Repository tsx is installed'; }
  catch { executor = 'Repository tsx is not installed at root; inspect package-local availability after install'; }
  return { fingerprint: observationHash({configuration: observationConfiguration(recipe), mainSeed: recipe.api?.seed, files: files.map(({path,sha256})=>({path,sha256})), routes}), files, executor, candidateRoutes: routes, omittedRoutes,
    mainSeed: { command: redact(recipe.api?.seed?.command ?? ''), provides: recipe.api?.seed?.provides },
    guidance: 'Reuse main-seed module execution and principal provisioning, not its business rows. Read omitted sources with read_file. Configuration/credentials are not inferred from file existence.' };
}
