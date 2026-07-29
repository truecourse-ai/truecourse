/**
 * CODE-TRUTH GROUNDING for scenario authoring (item 69) — the pure joins that turn
 * two analysis products into the two per-repo prompt blocks.
 *
 * Both exist because of the same measured failure class: a scenario that is right
 * about the CLAIM and wrong about the APP dies before the claim is ever exercised.
 * A signup that omits `name` 400s on a setup step; a `setup.http` stub scripting the
 * vendor's documented payload is rejected by the app itself, which asked that vendor
 * for a different representation and validates every field as a number.
 *
 * The joins are deliberately conservative — an unattributed fact is rendered without
 * a service name rather than guessed onto one, and an operation with no contract
 * still contributes its EXACT path (the third failure: invented routes).
 */

import type {
  ApiRequestContract,
  DetectedExternalService,
  Journey,
  OutboundRequest,
  RequestField,
} from '@truecourse/shared'
import type { JourneyContractHint, OutboundRequestHint } from './prompts.js'

/** Caps: enough to ground, never a dump. The prompt states the truncated count. */
export const MAX_OUTBOUND_REQUESTS = 8
export const MAX_QUERY_PARAMS = 14
export const MAX_RESPONSE_FIELDS = 20

/**
 * The flow's own operations, in the order matching walks them: exact method + path
 * (verbatim, so a request never has to be invented) plus the contract when the
 * repo's routes declare one. Non-api journeys and duplicates are dropped.
 */
export function buildJourneyContractHints(
  journeys: readonly Journey[],
  contracts: readonly ApiRequestContract[],
): JourneyContractHint[] {
  const byOperation = new Map<string, ApiRequestContract>()
  for (const contract of contracts) byOperation.set(`${contract.method} ${contract.path}`, contract)

  const seen = new Set<string>()
  const hints: JourneyContractHint[] = []
  for (const journey of journeys) {
    const entry = journey.entry as { method?: string; path?: string }
    if (journey.type !== 'api' || !entry?.method || !entry?.path) continue
    const key = `${entry.method.toUpperCase()} ${entry.path}`
    if (seen.has(key)) continue
    seen.add(key)
    const contract = byOperation.get(key)
    hints.push({
      method: entry.method.toUpperCase(),
      path: entry.path,
      ...(contract?.bodyFields ? { bodyFields: contract.bodyFields.map(copyField) } : {}),
      ...(contract?.queryFields ? { queryFields: contract.queryFields.map(copyField) } : {}),
    })
  }
  return hints
}

/**
 * The app's own outbound requests, attributed to a detected service when — and only
 * when — the source says which: the request's origin is a literal host of that
 * service, or the env var it reads is one of that service's base-URL variables. A
 * request whose base arrives as a parameter stays unattributed, which is the honest
 * answer and still carries every fact a stub needs.
 */
export function buildOutboundRequestHints(
  requests: readonly OutboundRequest[],
  services: readonly DetectedExternalService[],
): OutboundRequestHint[] {
  const hints: OutboundRequestHint[] = []
  for (const request of requests.slice(0, MAX_OUTBOUND_REQUESTS)) {
    const service = attributeService(request, services)
    const params = request.queryParams.slice(0, MAX_QUERY_PARAMS)
    const fields = request.responseFieldsRead.slice(0, MAX_RESPONSE_FIELDS)
    hints.push({
      ...(service ? { service } : {}),
      method: request.method,
      ...(request.pathLiteral ? { path: request.pathLiteral } : {}),
      ...(request.urlRef.baseExpr ? { base: request.urlRef.baseExpr } : {}),
      queryParams: params.map((p) => ({ ...p })),
      ...(request.queryParams.length > params.length
        ? { moreQueryParams: request.queryParams.length - params.length }
        : {}),
      ...(request.headers && request.headers.length > 0 ? { headers: request.headers.map((h) => ({ ...h })) } : {}),
      responseFields: fields.map((f) => ({ ...f })),
      ...(request.responseFieldsRead.length > fields.length
        ? { moreResponseFields: request.responseFieldsRead.length - fields.length }
        : {}),
    })
  }
  return hints
}

/** How many outbound requests were dropped by the cap — the prompt says so. */
export function outboundOverflow(requests: readonly OutboundRequest[]): number {
  return Math.max(0, requests.length - MAX_OUTBOUND_REQUESTS)
}

function attributeService(
  request: OutboundRequest,
  services: readonly DetectedExternalService[],
): string | undefined {
  const host = request.urlRef.host?.toLowerCase()
  const envVar = request.urlRef.envVar
  for (const service of services) {
    if (envVar && (service.baseUrlEnvs ?? []).some((e) => e.envVar === envVar)) return service.service
    if (envVar && service.baseUrlEnv === envVar) return service.service
    if (!host) continue
    const hosts = [
      ...(service.evidence ?? []).map((e) => hostOf(e.url)),
      ...(service.baseUrlEnvs ?? []).map((e) => hostOf(e.defaultUrl)),
    ].filter((h): h is string => !!h)
    if (hosts.includes(host)) return service.service
  }
  return undefined
}

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return undefined
  }
}

function copyField(field: RequestField): RequestField {
  return { name: field.name, required: field.required }
}
