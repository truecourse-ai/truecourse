/**
 * The outbound requests an analyzed tree constructs (item 69) — the repo-level view
 * of the per-file `outboundRequests` the URL-construction extractor harvests, the
 * `collectDatastoreUrls` precedent.
 *
 * A pure read of `FileAnalysis[]`: no second analysis pass, no I/O.
 */

import type { FileAnalysis, OutboundRequest } from '@truecourse/shared'

/**
 * Every outbound request the tree writes down, deduped by (method, path, base) and
 * ordered by source location so the same tree yields the same list on every run.
 * A request that carries no path, no query and no response reads is dropped: it
 * says nothing a stub author could act on.
 */
export function collectOutboundRequests(fileAnalyses: readonly FileAnalysis[]): OutboundRequest[] {
  const seen = new Set<string>()
  const out: OutboundRequest[] = []
  const requests = fileAnalyses.flatMap((file) => file.outboundRequests ?? []).sort(byLocation)
  for (const request of requests) {
    if (!request.pathLiteral && request.queryParams.length === 0 && request.responseFieldsRead.length === 0) continue
    const key = `${request.method} ${request.pathLiteral ?? ''} ${request.urlRef.host ?? ''} ${request.urlRef.baseExpr ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(request)
  }
  return out
}

function byLocation(a: OutboundRequest, b: OutboundRequest): number {
  return (
    a.location.filePath.localeCompare(b.location.filePath) ||
    a.location.startLine - b.location.startLine ||
    a.location.startColumn - b.location.startColumn
  )
}
