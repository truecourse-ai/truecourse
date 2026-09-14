/**
 * The WORKSPACE corpus as a {@link SpecSource}.
 *
 * The corpus components (`GuardCoveragePage`, `SpecOverlapDetail`,
 * `SpecDocViewer`) read their corpus, their documents and their decisions
 * through this seam rather than through `@/lib/api` directly, which is exactly
 * what lets Context point them at the workspace: one corpus, one set of
 * decisions, settled once for every repository that reads the documents.
 *
 * Only the READ half is this source's own: the decisions are the workspace's
 * wherever they are made, so the writers are the shared ones a repository
 * source uses too.
 *
 * `supportsScan` is false: the Document scan starts on Context's own header and
 * nowhere else (plan §5), so the pane offers no second Scan button of its own.
 */

import { getContextCorpus, getContextDoc, type SpecSkippedDoc } from '@/lib/api';
import {
  sliceSkipped,
  workspaceDecisionWriters,
  type SpecSource,
} from '@/components/spec/spec-source';

export function createWorkspaceContextSource(): SpecSource {
  let lastSkipped: SpecSkippedDoc[] = [];
  return {
    supportsScan: false,
    async getCorpus() {
      const res = await getContextCorpus();
      lastSkipped = res?.corpus.skippedDocs ?? [];
      return res;
    },
    getDoc: (ref) => getContextDoc(ref),
    async listSkipped(q) {
      return sliceSkipped(lastSkipped, q);
    },
    ...workspaceDecisionWriters,
    // The workspace has no on-demand scan from inside a pane: Context's header
    // owns it, and a source with nothing to do says nothing rather than lying.
    scan: async () => {},
  };
}
