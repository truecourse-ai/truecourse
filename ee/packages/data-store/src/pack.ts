/**
 * Helpers for content-addressed contract packing: hashing, bounded concurrency,
 * `.tc` tree walking, and path-traversal safety. Manifest paths are stored data
 * (a `.tc` filename is attacker-influenceable via a PR), so both the save side
 * (`assertSafeRel`) and the materialize side (`safeJoin`) guard against any path
 * that would escape the target root — this is the arbitrary-file-write surface
 * on a multi-tenant host.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ContractKind } from '@truecourse/core/lib/contract-store';

/** `sha256-<hex>` over the bytes. */
export function sha256(bytes: Buffer): string {
  return 'sha256-' + createHash('sha256').update(bytes).digest('hex');
}

/**
 * Run `fn` over `items` with at most `limit` in flight. On the first error,
 * stops pulling new work but lets in-flight calls settle before rejecting — so a
 * caller's cleanup (e.g. `rm` of a temp dir) can't race a still-running worker
 * that would re-create it.
 */
export async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  let firstErr: unknown;
  const worker = async (): Promise<void> => {
    while (next < items.length && firstErr === undefined) {
      const i = next++;
      try {
        await fn(items[i]!, i);
      } catch (err) {
        if (firstErr === undefined) firstErr = err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  if (firstErr !== undefined) throw firstErr;
}

/** Stable, sorted copy of a `{path: hash}` map so the manifest hash is deterministic. */
export function sortKeys(map: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(map).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * Reject a relative path that could escape its root: empty, null byte, absolute,
 * a Windows drive/UNC, or any `.`/`..` segment (after normalizing `\` → `/`, so
 * a literal `a\b` that becomes a separator on another OS is also caught).
 */
export function assertSafeRel(rel: string): void {
  if (!rel || rel.includes('\0')) throw new Error(`[ee-data-store] unsafe manifest path: ${JSON.stringify(rel)}`);
  const norm = rel.replace(/\\/g, '/');
  if (norm.startsWith('/') || /^[a-zA-Z]:/.test(norm)) {
    throw new Error(`[ee-data-store] absolute manifest path rejected: ${JSON.stringify(rel)}`);
  }
  for (const seg of norm.split('/')) {
    if (seg === '..' || seg === '.' || seg === '') {
      throw new Error(`[ee-data-store] unsafe manifest segment in: ${JSON.stringify(rel)}`);
    }
  }
}

/** Resolve `rel` under `root`, asserting it stays contained. */
export function safeJoin(root: string, rel: string): string {
  assertSafeRel(rel);
  const base = path.resolve(root);
  const dest = path.resolve(base, rel.replace(/\\/g, '/'));
  if (dest !== base && !dest.startsWith(base + path.sep)) {
    throw new Error(`[ee-data-store] manifest path escapes root: ${JSON.stringify(rel)}`);
  }
  return dest;
}

/**
 * Posix-relative paths of every `.tc` file under `root`. For `kind:'contracts'`
 * the top-level `_inferred/` subtree is excluded (authored contracts only),
 * matching the verifier's `walkTcFiles`. For `kind:'contracts_inferred'` the
 * `root` IS the `_inferred` dir, so nothing is excluded.
 */
export function walkTcRelFiles(root: string, kind: ContractKind): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (kind === 'contracts' && rel === '' && e.name === '_inferred') continue;
        walk(childRel);
      } else if (e.isFile() && e.name.endsWith('.tc')) {
        out.push(childRel);
      }
    }
  };
  walk('');
  return out;
}
