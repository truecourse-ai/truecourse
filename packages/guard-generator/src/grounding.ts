/**
 * CODE-TRUTH GROUNDING for scenario authoring — the pure joins that turn
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
  Interface,
  OutboundRequest,
  RequestField,
} from '@truecourse/shared'
import type { InterfaceContractHint, OutboundRequestHint } from './prompts.js'

/** Caps: enough to ground, never a dump. The prompt states the truncated count. */
export const MAX_OUTBOUND_REQUESTS = 8
export const MAX_QUERY_PARAMS = 14
export const MAX_RESPONSE_FIELDS = 20
/**
 * Cap on the REST of the api surface a flow may reach for in a setup step. Wider
 * than the outbound cap (one line each, and a setup step can need any of them) but
 * still bounded — a 400-route app must not turn the prompt into a route dump.
 */
export const MAX_OTHER_OPERATIONS = 30

/**
 * The flow's own operations, in the order matching walks them: exact method + path
 * (verbatim, so a request never has to be invented) plus the contract when the
 * repo's routes declare one. Non-api interfaces and duplicates are dropped.
 */
export function buildInterfaceContractHints(
  interfaces: readonly Interface[],
  contracts: readonly ApiRequestContract[],
): InterfaceContractHint[] {
  const byOperation = new Map<string, ApiRequestContract>()
  for (const contract of contracts) byOperation.set(`${contract.method} ${contract.path}`, contract)

  const seen = new Set<string>()
  const hints: InterfaceContractHint[] = []
  for (const iface of interfaces) {
    const entry = iface.entry as { method?: string; path?: string }
    if (iface.type !== 'api' || !entry?.method || !entry?.path) continue
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
 * The REST of the app's api surface — every operation the catalog offers that this
 * flow's own interfaces do NOT walk, with the same contract rendering. A flow reaches
 * for these on SETUP steps (a favorites flow has to sign up and sign in first, and
 * neither is one of its milestones), which is exactly the world the flow's own
 * operations list cannot describe. Capped, with the dropped count reported so the
 * prompt never pretends the list is complete.
 */
export function buildOtherOperationHints(
  catalogInterfaces: readonly Interface[],
  contracts: readonly ApiRequestContract[],
  own: readonly InterfaceContractHint[],
): { operations: InterfaceContractHint[]; overflow: number } {
  const walked = new Set(own.map((o) => `${o.method} ${o.path}`))
  const rest = buildInterfaceContractHints(catalogInterfaces, contracts).filter(
    (hint) => !walked.has(`${hint.method} ${hint.path}`),
  )
  return {
    operations: rest.slice(0, MAX_OTHER_OPERATIONS),
    overflow: Math.max(0, rest.length - MAX_OTHER_OPERATIONS),
  }
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
