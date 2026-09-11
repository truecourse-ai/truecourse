/**
 * Reading a source's scope out of its stored `config` jsonb, and deriving the
 * identity a new source takes.
 *
 * The config is user input on the way in (the add dialog) and untyped JSON on
 * the way out (a jsonb column), so every driver reads it through here rather
 * than casting — a malformed scope is a {@link ContextConfigError} naming what
 * is wrong, never a driver that syncs the wrong thing.
 */

import {
  DEFAULT_REPOSITORY_EXCLUDE,
  DEFAULT_REPOSITORY_INCLUDE,
  type ContextSourceConfig,
  type RepositorySourceConfig,
  type SiteSourceConfig,
} from '@truecourse/shared';
import { assertLlmsTxtUrl, slugifyId } from '@truecourse/spec-consolidator';
import { isValidContextSourceId } from '../../lib/context-ref.js';
import { ContextConfigError } from './types.js';

function globs(value: unknown, fallback: readonly string[]): string[] {
  if (value === undefined || value === null) return [...fallback];
  if (!Array.isArray(value)) throw new ContextConfigError('Patterns must be a list of globs.');
  return value
    .filter((glob): glob is string => typeof glob === 'string' && glob.trim() !== '')
    .map((glob) => glob.trim());
}

/** The scope of a Repository source, with the defaults filled in. */
export function repositoryConfig(config: ContextSourceConfig): RepositorySourceConfig {
  const raw = (config ?? {}) as Partial<RepositorySourceConfig>;
  // The identity every store, clone and link keys by — `owner/repo` on a hosted
  // server. WHICH repository a caller may name is the route's check (it must be
  // one this workspace connected); all that is refused here is a blank one.
  const repoFullName = typeof raw.repoFullName === 'string' ? raw.repoFullName.trim() : '';
  if (repoFullName === '' || /\s/.test(repoFullName)) {
    throw new ContextConfigError('A repository source needs the repository it reads (repoFullName).');
  }
  return {
    repoFullName,
    include: globs(raw.include, DEFAULT_REPOSITORY_INCLUDE),
    exclude: globs(raw.exclude, DEFAULT_REPOSITORY_EXCLUDE),
    branch: typeof raw.branch === 'string' ? raw.branch.trim() : '',
  };
}

/** The scope of a site source: the llms.txt URL, validated and normalized. */
export function siteConfig(config: ContextSourceConfig): SiteSourceConfig {
  const raw = (config ?? {}) as Partial<SiteSourceConfig>;
  const url = typeof raw.llmsTxtUrl === 'string' ? raw.llmsTxtUrl.trim() : '';
  if (!url) throw new ContextConfigError("A documentation site needs its llms.txt URL.");
  // Throws InvalidSourceUrlError for anything that is not an llms.txt URL —
  // the same gate `spec source add` applies.
  return { llmsTxtUrl: assertLlmsTxtUrl(url) };
}

/**
 * The id a Repository source takes: `repo-<owner>-<name>`, so it is one clean
 * ref segment and reads as what it is on the Documents view.
 */
export function repositorySourceId(repoFullName: string): string {
  const slug = slugifyId(repoFullName.replace('/', '-'));
  const id = `repo-${slug}`;
  if (!isValidContextSourceId(id)) {
    throw new ContextConfigError(`${repoFullName} does not yield a usable source id.`);
  }
  return id;
}

/**
 * The id a site source takes, derived from its llms.txt URL the way the
 * per-repository registry derives one, prefixed so the two kinds never collide.
 * `taken` disambiguates within the workspace (two deployments of one host).
 */
export function siteSourceId(llmsTxtUrl: string, taken: ReadonlySet<string> = new Set()): string {
  const url = new URL(llmsTxtUrl);
  const path = url.pathname.replace(/\/llms\.txt$/i, '').replace(/^\/+|\/+$/g, '');
  const base = `site-${slugifyId(path ? `${url.host}-${path}` : url.host)}`;
  if (!isValidContextSourceId(base)) {
    throw new ContextConfigError(`${llmsTxtUrl} does not yield a usable source id.`);
  }
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
