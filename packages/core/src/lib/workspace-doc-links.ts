/**
 * Seam for resolving a synced workspace-KB doc path to its external source link.
 *
 * A drift's `specOrigin.source` can be a workspace knowledge doc (e.g.
 * `knowledge/confluence/98525.md`) rather than a file in the repo — those live in
 * the hosted EE Postgres (`knowledge_documents`), keyed by `docPath`, with the real
 * deep-link in `url` and a human `title`. OSS has no workspace KB, so this seam is a
 * no-op there (returns no links → the dashboard renders the source as plain text).
 * The EE server installs a resolver at boot that maps the repo → its workspace org →
 * the doc rows.
 */

export interface WorkspaceDocLink {
  /** External deep-link to the source doc (e.g. the Confluence page). */
  url: string | null;
  /** Human title of the source doc. */
  title: string | null;
}

/**
 * Resolve a batch of candidate source paths for one repo to their workspace-doc
 * links. Only paths that ARE workspace docs appear in the returned map; repo file
 * paths (and anything unknown) are simply absent.
 */
export type WorkspaceDocLinkResolver = (
  repoKey: string,
  docPaths: string[],
) => Promise<Map<string, WorkspaceDocLink>>;

let resolver: WorkspaceDocLinkResolver | null = null;

export function setWorkspaceDocLinkResolver(fn: WorkspaceDocLinkResolver | null): void {
  resolver = fn;
}

export function getWorkspaceDocLinkResolver(): WorkspaceDocLinkResolver | null {
  return resolver;
}

/**
 * Resolve workspace-doc links for `docPaths`. Returns an empty map when no resolver
 * is installed (OSS), when there are no paths, or on any resolver error — callers
 * degrade to plain-text sources, never throw.
 */
export async function resolveWorkspaceDocLinks(
  repoKey: string,
  docPaths: string[],
): Promise<Map<string, WorkspaceDocLink>> {
  if (!resolver || docPaths.length === 0) return new Map();
  try {
    return await resolver(repoKey, [...new Set(docPaths)]);
  } catch {
    return new Map();
  }
}

// ---------------------------------------------------------------------------
// Origin-link attachment — pair a drift's `specOrigin.source` with the resolved
// workspace-doc link so the dashboard "Source" can deep-link out. Generic over a
// minimal `specOrigin` shape; repo-doc origins (no matching link) pass through.
// ---------------------------------------------------------------------------

interface SpecOriginLike {
  source: string;
  section: string;
  lines: [number, number];
  sourceUrl?: string | null;
  sourceLabel?: string | null;
}

interface DriftLike {
  specOrigin?: SpecOriginLike;
}

/** Distinct `specOrigin.source` values across drifts — the lookup batch for links. */
export function collectOriginSources(drifts: DriftLike[]): string[] {
  const sources = new Set<string>();
  for (const d of drifts) {
    if (d.specOrigin?.source) sources.add(d.specOrigin.source);
  }
  return [...sources];
}

/**
 * Attach an external `sourceUrl` (+ `sourceLabel`) to drifts whose origin source is
 * a workspace-KB doc — keyed by `source` against the resolved link map. Origins with
 * no matching workspace link (repo docs, unknowns) are left untouched.
 */
export function attachOriginLinks<T extends DriftLike>(
  drifts: T[],
  links: Map<string, { url: string | null; title: string | null }>,
): T[] {
  if (links.size === 0) return drifts;
  return drifts.map((d) => {
    const origin = d.specOrigin;
    if (!origin) return d;
    const link = links.get(origin.source);
    if (!link?.url) return d;
    return {
      ...d,
      specOrigin: { ...origin, sourceUrl: link.url, sourceLabel: link.title ?? origin.sourceLabel ?? null },
    };
  });
}
