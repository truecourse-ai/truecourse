/**
 * The api surface's REQUEST/RESPONSE CONTRACTS: what each operation's handler
 * reads off the request — and what it statically produces back (`produces`:
 * response statuses + top-level response-body keys) — keyed by the operation
 * identity interfaces already use.
 *
 * It lives beside the api derivation because it must compose paths EXACTLY as
 * `deriveApiInterfacesFromTree` does — mount prefix included, `canonicalRoutePath`
 * applied — or the generator's per-interface join silently misses. One derivation of
 * "which operation is this route", two products.
 *
 * The join this layer owns, and the file level cannot: a handler that hands
 * `req.body` to `parseSignupBody` records the SYMBOL; the function that declares
 * it usually lives in another file. Resolution is by name across the analyzed
 * tree — the same name-resolution honesty the mount resolver already applies.
 *
 * NOT snapshotted, deliberately: like the detected external services this is a
 * fact about the working tree, re-derived every mapping, never a stale committed
 * claim.
 */

import {
  canonicalRoutePath,
  type ApiRequestContract,
  type FileAnalysis,
  type RequestField,
  type RequestValidator,
} from '@truecourse/shared'
import { buildMountPrefixes, composePath } from './api-tree.js'

/**
 * One contract per operation the tree registers, ordered by path then method (the
 * interface ordering). `ALL` routes are skipped for the same reason interfaces skip
 * them: a catch-all is not an operation a contract names.
 */
export function collectApiRequestContracts(fileAnalyses: readonly FileAnalysis[]): ApiRequestContract[] {
  const validators = buildValidatorIndex(fileAnalyses)
  const prefixes = buildMountPrefixes(fileAnalyses)
  const byOperation = new Map<
    string,
    {
      method: string
      path: string
      body: FieldMerge
      query: FieldMerge
      statuses: Set<number>
      bodyKeys: Set<string>
    }
  >()

  for (const file of fileAnalyses) {
    const prefix = prefixes.get(file.filePath) ?? ''
    for (const route of file.routeRegistrations ?? []) {
      if (route.httpMethod === 'ALL') continue
      const contract = route.requestContract
      if (!contract) continue
      const path = canonicalRoutePath(composePath(prefix, route.path))
      const key = `${route.httpMethod} ${path}`
      const entry = byOperation.get(key) ?? {
        method: route.httpMethod,
        path,
        body: new FieldMerge(),
        query: new FieldMerge(),
        statuses: new Set<number>(),
        bodyKeys: new Set<string>(),
      }
      entry.body.addAll(contract.bodyFields ?? [])
      entry.query.addAll(contract.queryFields ?? [])
      for (const ref of contract.bodyValidatorRefs ?? []) entry.body.addAll(validators.get(ref) ?? [])
      for (const ref of contract.queryValidatorRefs ?? []) entry.query.addAll(validators.get(ref) ?? [])
      for (const status of contract.produces?.statuses ?? []) entry.statuses.add(status)
      for (const bodyKey of contract.produces?.bodyKeys ?? []) entry.bodyKeys.add(bodyKey)
      byOperation.set(key, entry)
    }
  }

  const out: ApiRequestContract[] = []
  for (const entry of byOperation.values()) {
    const bodyFields = entry.body.list()
    const queryFields = entry.query.list()
    // Pass-through merge of the response side: statuses sorted for a canonical
    // order, body keys kept first-seen like the field lists.
    const produces = {
      ...(entry.statuses.size > 0 ? { statuses: [...entry.statuses].sort((a, b) => a - b) } : {}),
      ...(entry.bodyKeys.size > 0 ? { bodyKeys: [...entry.bodyKeys] } : {}),
    }
    const hasProduces = Object.keys(produces).length > 0
    // The honesty rule, operation-level: an operation the walks established
    // NOTHING about — no request field, no response fact — gets no contract.
    if (bodyFields.length === 0 && queryFields.length === 0 && !hasProduces) continue
    out.push({
      method: entry.method,
      path: entry.path,
      ...(bodyFields.length > 0 ? { bodyFields } : {}),
      ...(queryFields.length > 0 ? { queryFields } : {}),
      ...(hasProduces ? { produces } : {}),
    })
  }
  return out.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
}

/**
 * Validator symbol → its fields. A name declared in two files is ambiguous, so the
 * first by (file, line) wins and the run is deterministic; naming the same
 * validator twice is the repo's ambiguity, not a reason to drop the contract.
 */
function buildValidatorIndex(fileAnalyses: readonly FileAnalysis[]): Map<string, RequestField[]> {
  const all: RequestValidator[] = fileAnalyses
    .flatMap((file) => (file.requestValidators ?? []).map((v) => v))
    .sort(
      (a, b) =>
        a.location.filePath.localeCompare(b.location.filePath) || a.location.startLine - b.location.startLine,
    )
  const index = new Map<string, RequestField[]>()
  for (const validator of all) if (!index.has(validator.name)) index.set(validator.name, validator.fields)
  return index
}

/** Fields deduped by name, first-seen order, a KNOWN requiredness beating `'unknown'`. */
class FieldMerge {
  private readonly fields = new Map<string, RequestField>()

  addAll(fields: readonly RequestField[]): void {
    for (const field of fields) {
      const existing = this.fields.get(field.name)
      if (!existing) {
        this.fields.set(field.name, { ...field })
        continue
      }
      if (existing.required === 'unknown' && field.required !== 'unknown') existing.required = field.required
      else if (existing.required === false && field.required === true) existing.required = true
    }
  }

  list(): RequestField[] {
    return [...this.fields.values()].map((f) => ({ ...f }))
  }
}
