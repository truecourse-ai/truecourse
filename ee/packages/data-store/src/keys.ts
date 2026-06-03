/**
 * Blob-key layout for the hosted analysis/verify stores. Mirrors the file
 * impl's `.truecourse/` tree, but flattened into opaque blob keys:
 *
 *   <repo>/latest                     analyze LATEST snapshot
 *   <repo>/diff                       analyze diff (optional)
 *   <repo>/analyses/<filename>        per-analysis snapshot
 *   <repo>/verify/latest              verify LATEST baseline
 *   <repo>/verify/diff                verify diff (optional)
 *   <repo>/verify/runs/<filename>     per-run drift snapshot
 *
 * `repoKey` is the opaque per-repo identity (the seam's `repoPath`). It is
 * percent-encoded into a single key segment so a key containing slashes can't
 * collide with the fixed path structure or escape its prefix.
 */

export function repoPrefix(repoKey: string): string {
  return encodeURIComponent(repoKey);
}

export const latestKey = (repoKey: string): string => `${repoPrefix(repoKey)}/latest`;
export const diffKey = (repoKey: string): string => `${repoPrefix(repoKey)}/diff`;
export const analysisKey = (repoKey: string, filename: string): string =>
  `${repoPrefix(repoKey)}/analyses/${filename}`;

export const verifyLatestKey = (repoKey: string): string => `${repoPrefix(repoKey)}/verify/latest`;
export const verifyDiffKey = (repoKey: string): string => `${repoPrefix(repoKey)}/verify/diff`;
export const verifyRunKey = (repoKey: string, filename: string): string =>
  `${repoPrefix(repoKey)}/verify/runs/${filename}`;

/** Prefix under which a contract kind's content-addressed objects live (GC scans it). */
export const contractObjectPrefix = (repoKey: string, kind: string): string =>
  `${repoPrefix(repoKey)}/${kind}/objects/`;
/** One immutable, content-addressed `.tc` object (`sha` = `sha256-<hex>`). */
export const contractObjectKey = (repoKey: string, kind: string, sha: string): string =>
  `${contractObjectPrefix(repoKey, kind)}${sha}`;
