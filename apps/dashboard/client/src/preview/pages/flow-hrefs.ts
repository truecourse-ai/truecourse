/**
 * Where the flows live, as addresses. One module, so the Flows page, the
 * repository console's jumps and an interface's "grounds" link all spell the
 * same place the same way.
 *
 * A flow belongs to a repository, but the LIST is the workspace's, so the
 * repository is a parameter of the address rather than a segment of it: the
 * index narrows by `?repo=` (the filter row's own key) and one flow is read
 * through the `?repo=` it names.
 */

import { PREVIEW_BASE } from '@/preview/shell/base';

/** Every flow of every connected repository. */
export const FLOWS_BASE = `${PREVIEW_BASE}/flows`;

/** The list, narrowed to one repository when a caller has one. */
export function flowsHref(repoId?: string): string {
  return repoId ? `${FLOWS_BASE}?repo=${encodeURIComponent(repoId)}` : FLOWS_BASE;
}

/** ONE flow, read through the repository it belongs to. */
export function flowHref(flowId: string, repoId: string): string {
  return `${FLOWS_BASE}/${encodeURIComponent(flowId)}?repo=${encodeURIComponent(repoId)}`;
}
