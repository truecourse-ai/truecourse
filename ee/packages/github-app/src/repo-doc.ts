/**
 * Read a connected repo's doc from GitHub via the App installation.
 *
 * Hosted EE has no persistent checkout, so the dashboard's Spec tab can't read
 * source docs (README, ADRs) off disk. This fetches the file through the
 * installation-authed REST client at the repo's saved baseline commit — the
 * revision the corpus was scanned at — falling back to the default branch HEAD.
 * Returns null when the repo isn't connected or the file doesn't exist, so the
 * route degrades to a clean 404.
 */

import type { GithubAppConfig } from './config.js';
import type { GateStore } from './store/types.js';
import { installationOctokit, splitRepo } from './octokit.js';

export async function readRepoDocFromGithub(
  cfg: GithubAppConfig,
  store: GateStore,
  repoFullName: string,
  docPath: string,
): Promise<string | null> {
  const repo = await store.getRepo(repoFullName);
  if (!repo) return null;

  const baseline = await store.getBaseline(repoFullName);
  const ref = baseline?.commitSha ?? repo.defaultBranch;
  const octokit = installationOctokit(cfg, repo.installationId);
  const { owner, repo: name } = splitRepo(repoFullName);

  try {
    // `format: 'raw'` returns the file body directly (as text), avoiding the
    // 1 MB base64 cap of the default JSON response — docs can be large.
    const res = await octokit.repos.getContent({
      owner,
      repo: name,
      path: docPath,
      ref,
      mediaType: { format: 'raw' },
    });
    // With the raw media type the payload is the file text, though the generated
    // types still describe the JSON union — narrow to string.
    return typeof res.data === 'string' ? res.data : null;
  } catch {
    // 404 (missing file / bad ref) or any API error → treat as not found.
    return null;
  }
}
