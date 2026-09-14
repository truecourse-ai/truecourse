/**
 * The WORKSPACE corpus as a {@link SpecSource}.
 *
 * The corpus components (`GuardCoveragePage`, `SpecOverlapDetail`,
 * `SpecDocViewer`) read their corpus, their documents and their decisions
 * through this seam rather than through `@/lib/api` directly, which is exactly
 * what lets Context point them at the workspace: one corpus, one set of
 * decisions, settled once for every repository that reads the documents.
 *
 * `supportsScan` is false: the Document scan starts on Context's own header and
 * nowhere else (plan §5), so the pane offers no second Scan button of its own.
 */

import {
  addContextExclude,
  addContextInclude,
  deleteContextConflictResolution,
  getContextCorpus,
  getContextDoc,
  postContextConflictResolution,
  removeContextExclude,
  removeContextInclude,
  type SpecSkippedDoc,
} from '@/lib/api';
import { sliceSkipped, type SpecSource } from '@/components/spec/spec-source';

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
    addInclude: (ref) => addContextInclude(ref),
    removeInclude: (ref) => removeContextInclude(ref),
    addExclude: (ref) => addContextExclude(ref),
    removeExclude: (ref) => removeContextExclude(ref),
    postConflictResolution: (payload) => postContextConflictResolution(payload),
    deleteConflictResolution: (payload) => deleteContextConflictResolution(payload),
    // The workspace has no on-demand scan from inside a pane: Context's header
    // owns it, and a source with nothing to do says nothing rather than lying.
    scan: async () => {},
  };
}
