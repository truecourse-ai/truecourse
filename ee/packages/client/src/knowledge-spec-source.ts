/**
 * The WORKSPACE implementation of the spec-corpus data-source seam
 * (`@/components/spec/spec-source`). Backs the reused corpus components on the
 * Knowledge page with the org-scoped `/api/ee/knowledge/spec/*` endpoints instead
 * of the repo routes, so the exact same `SpecCorpusView` / `SpecOverlapDetail` /
 * `SpecDocViewer` render the cross-repo corpus.
 *
 * Differences from the repo default:
 *   - `supportsScan: false` — content arrives via Sync/Process on Integrations,
 *     not an on-demand Scan; the components hide the Scan affordance + empty state.
 *   - The corpus payload ships a skipped SUMMARY only; `listSkipped` is a real
 *     paginated request (`GET /spec/skipped`), not a client-side slice.
 *   - Decision writes return the OSS ack shape (decision lists / verdict list);
 *     the server re-processes in the background and the next corpus GET folds them.
 */

import type {
  SpecConflictAck,
  SpecCorpusResponse,
  SpecDecisionAck,
} from '@/lib/api';
import type {
  ConflictResolutionPayload,
  DeleteConflictPayload,
  SkippedPage,
  SkippedQuery,
  SpecSource,
} from '@/components/spec/spec-source';
import { getJson, getJsonAllow404, postJson, delJson } from './api';

const BASE = '/api/ee/knowledge/spec';

export function createWorkspaceSpecSource(): SpecSource {
  return {
    supportsScan: false,
    getCorpus: () => getJsonAllow404<SpecCorpusResponse>(`${BASE}/corpus`),
    getDoc: (ref) => getJson<{ ref: string; content: string }>(`${BASE}/doc?ref=${encodeURIComponent(ref)}`),
    listSkipped: async (q: SkippedQuery): Promise<SkippedPage> => {
      const params = new URLSearchParams();
      if (q.query) params.set('query', q.query);
      if (q.reason) params.set('reason', q.reason);
      params.set('limit', String(q.limit));
      params.set('offset', String(q.offset));
      // The wire field is `skipped`; the seam's page shape names it `docs`.
      const page = await getJson<{ skipped: SkippedPage['docs']; total: number }>(
        `${BASE}/skipped?${params.toString()}`,
      );
      return { docs: page.skipped, total: page.total };
    },
    addInclude: (ref) => postJson<SpecDecisionAck>(`${BASE}/includes`, { ref }),
    removeInclude: (ref) => delJson<SpecDecisionAck>(`${BASE}/includes`, { ref }),
    addExclude: (ref) => postJson<SpecDecisionAck>(`${BASE}/excludes`, { ref }),
    removeExclude: (ref) => delJson<SpecDecisionAck>(`${BASE}/excludes`, { ref }),
    postConflictResolution: (payload: ConflictResolutionPayload) =>
      postJson<SpecConflictAck>(`${BASE}/conflict-resolution`, payload),
    deleteConflictResolution: (payload: DeleteConflictPayload) =>
      delJson<SpecConflictAck>(`${BASE}/conflict-resolution`, payload),
    scan: async () => null,
  };
}
