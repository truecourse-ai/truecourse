/**
 * EXTERNAL-SERVICE DETECTION — which named third parties the repo depends on.
 *
 * A PURE function over `FileAnalysis[]` (no I/O, no parse pass of its own), so a
 * caller that already analyzed the tree — guard generate's journey mapping does —
 * pays nothing extra for it.
 *
 * It reads the SAME registry `layer-detector.ts` reads (`externalLayerPatterns`),
 * but keeps what the layer detector throws away: the layer detector early-returns
 * on the first match and folds the service name into a prose `reasons` string,
 * because all it owes its caller is the boolean "this file is an external-layer
 * file". Here the per-service IDENTITY is the product, so nothing early-returns —
 * every file is matched against every category, and a file importing both stripe
 * and sendgrid yields both.
 *
 * TWO SOURCES since item 63. The registry can only name what a repo IMPORTS, so an
 * app that speaks to its upstream with a bare `fetch` and a URL string detects as
 * having no third party at all — which is worse than a wrong answer, because the
 * gap reason then blames a generic noun. The second source is therefore the URL
 * LITERALS themselves (`FileAnalysis.externalHttpRefs`, harvested by
 * `extractors/external-http.ts`), grouped by registrable domain into one service per
 * vendor. The two results are UNIONED by service name; an SDK match wins the
 * identity (it has a registry category), and the base-URL env vars merge.
 *
 * What it deliberately does NOT report:
 * - Generic HTTP clients (axios, requests, HttpClient). A transport is not a
 *   service identity — "blocked on axios" tells a reader nothing. Ask
 *   {@link usesRawHttpClient} separately when the transport itself is the point.
 * - The registry's `filePatterns` (`**\/integrations/**` &c). A path convention
 *   says a file is integration-shaped; it never names WHICH third party.
 */

import type {
  BaseUrlEnv,
  DetectedExternalService,
  ExternalServiceCategory,
  ExternalServiceEvidence,
  ExternalHttpRef,
  FileAnalysis,
} from '@truecourse/shared'
import { externalLayerPatterns } from './patterns/layer-patterns.js'
import { matchesPattern } from './patterns/index.js'

/** Evidence files kept per service — enough to point at, small enough to snapshot. */
const EVIDENCE_CAP = 5

/** The registry sections that carry a named service, with the category each means. */
const NAMED_CATEGORIES: { category: ExternalServiceCategory; packages: Record<string, string[]> }[] = [
  { category: 'cloud', packages: externalLayerPatterns.cloudServices },
  { category: 'payment', packages: externalLayerPatterns.paymentServices },
  { category: 'messaging', packages: externalLayerPatterns.messagingServices },
  { category: 'ai', packages: externalLayerPatterns.aiServices },
  { category: 'auth', packages: externalLayerPatterns.authServices },
  {
    category: 'queue',
    packages: Object.fromEntries(
      Object.entries(externalLayerPatterns.messageQueues).map(([name, cfg]) => [name, cfg.packages]),
    ),
  },
]

/**
 * The import specifiers ONE import statement should be matched against: the source
 * as written, plus its package ROOT when the source reaches into a package
 * (`stripe/lib/Webhooks` → `stripe`, `@azure/storage-blob/foo` → `@azure/storage-blob`).
 * The registry's `matchesPattern` is exact-or-glob, so without this a deep import
 * of a known SDK reads as an unknown package.
 */
function importCandidates(source: string): string[] {
  const out = [source]
  const parts = source.split('/')
  const rootLength = source.startsWith('@') ? 2 : 1
  if (parts.length > rootLength) {
    const root = parts.slice(0, rootLength).join('/')
    if (root) out.push(root)
  }
  // Dotted module paths (Python `boto3.session`, C# `Azure.Storage.Blobs`) reach
  // into a package the same way — their root is the dependency's name.
  const dotted = source.split('.')
  if (dotted.length > 1 && dotted[0]) out.push(dotted[0])
  return out
}

/** Alphanumeric tokens of a canonical service name, e.g. `aws-sqs` → `aws`, `sqs`. */
function serviceTokens(service: string): string[] {
  return service.split(/[^a-z0-9]+/i).filter((t) => t.length >= 3)
}

/** Env identifiers that read like a base-URL override — `STRIPE_API_BASE`, `SENDGRID_HOST`. */
const BASE_URL_ENV = /\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/g
const BASE_URL_HINT = /(?:^|_)(URL|URI|BASE|BASEURL|HOST|HOSTNAME|ENDPOINT|API_BASE)(?:_|$)/

/**
 * Best-effort base-URL env var for a service, read out of the CALL text of the
 * files that import it (`new Stripe(key, { apiBase: process.env.STRIPE_API_BASE })`
 * — call arguments are captured as raw source).
 *
 * LIMIT, deliberate: there is no env-read extractor, so an override assigned at
 * module top level (`const base = process.env.STRIPE_API_BASE`) is invisible here.
 * Absence therefore means "not seen", never "not configurable" — which is why the
 * field is telemetry and nothing branches on it.
 */
function findBaseUrlEnv(service: string, files: readonly FileAnalysis[]): string | undefined {
  const tokens = serviceTokens(service)
  if (tokens.length === 0) return undefined
  for (const file of files) {
    for (const call of file.calls) {
      const text = [call.callee, ...(call.arguments ?? [])].join(' ')
      for (const [, identifier] of text.matchAll(BASE_URL_ENV)) {
        if (!BASE_URL_HINT.test(identifier)) continue
        const lower = identifier.toLowerCase()
        if (tokens.some((t) => lower.includes(t))) return identifier
      }
    }
  }
  return undefined
}

/**
 * Multi-part public suffixes, the handful that actually occur. Kept as a LIST rather
 * than a public-suffix dependency on purpose: the product here is a readable service
 * NAME, and being wrong about `foo.co.uk` costs a slightly odd name, never a wrong
 * blocked-on decision. Add to it when a real repo proves one missing.
 */
const MULTI_PART_TLDS: readonly string[] = [
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk',
  'com.au', 'net.au', 'org.au', 'com.br', 'com.mx', 'com.ar',
  'co.jp', 'or.jp', 'ne.jp', 'co.kr', 'co.nz', 'co.za', 'co.in', 'co.il',
  'com.cn', 'com.hk', 'com.sg', 'com.tr', 'com.tw', 'com.pl', 'com.es',
]

/**
 * The registrable domain of `host` — its last two labels, or three when the last two
 * are a known multi-part suffix. `geocoding-api.open-meteo.com` → `open-meteo.com`,
 * `api.foo.co.uk` → `foo.co.uk`. This is the GROUPING KEY: every subdomain a vendor
 * serves is one service, because "blocked on open-meteo" is the sentence a reader
 * needs, not "blocked on api.open-meteo.com and geocoding-api.open-meteo.com".
 */
export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().split('.').filter(Boolean)
  if (labels.length <= 2) return labels.join('.')
  const lastTwo = labels.slice(-2).join('.')
  const take = MULTI_PART_TLDS.includes(lastTwo) ? 3 : 2
  return labels.slice(-take).join('.')
}

/** The service NAME for a registrable domain: the domain minus its public suffix. */
export function serviceNameFromDomain(domain: string): string {
  const labels = domain.split('.')
  const suffixLabels = MULTI_PART_TLDS.includes(labels.slice(-2).join('.')) ? 2 : 1
  return labels.slice(0, Math.max(1, labels.length - suffixLabels)).join('.')
}

/** Options a CALLER can supply that the file analyses cannot answer for themselves. */
export interface DetectExternalServicesOptions {
  /**
   * Hosts the repo OWNS — its own deployed origins, read from wherever the caller
   * knows them. A URL to your own API is not a third-party dependency, but nothing
   * in a `FileAnalysis` says which hosts are yours, so the answer has to come from
   * outside. Matched on the host and on its subdomains.
   */
  ownHosts?: readonly string[]
}

/**
 * The named third parties `fileAnalyses` depends on — SDK imports ∪ bare HTTP hosts
 * — sorted by service name so the result is stable across runs (file discovery order
 * is not part of the identity).
 */
export function detectExternalServices(
  fileAnalyses: readonly FileAnalysis[],
  options: DetectExternalServicesOptions = {},
): DetectedExternalService[] {
  const sdk = detectSdkServices(fileAnalyses)
  const http = detectHttpServices(fileAnalyses, options.ownHosts ?? [])
  return mergeDetections(sdk, http)
}

/** The import-registry half — unchanged since item 57 except for its new fields. */
function detectSdkServices(fileAnalyses: readonly FileAnalysis[]): DetectedExternalService[] {
  const hits = new Map<string, { category: ExternalServiceCategory; evidence: ExternalServiceEvidence[]; files: FileAnalysis[] }>()

  for (const file of fileAnalyses) {
    for (const imp of file.imports) {
      const candidates = importCandidates(imp.source)
      for (const { category, packages } of NAMED_CATEGORIES) {
        for (const [service, specifiers] of Object.entries(packages)) {
          const matched = specifiers.some((spec) => candidates.some((c) => matchesPattern(c, spec)))
          if (!matched) continue
          const hit = hits.get(service) ?? { category, evidence: [], files: [] }
          if (hit.evidence.length < EVIDENCE_CAP) {
            hit.evidence.push({ filePath: file.filePath, importSource: imp.source })
          }
          if (!hit.files.includes(file)) hit.files.push(file)
          hits.set(service, hit)
        }
      }
    }
  }

  return [...hits.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([service, hit]) => {
      const baseUrlEnv = findBaseUrlEnv(service, hit.files)
      // The registry path only ever knew the NAME heuristic — it stays that tier.
      const baseUrlEnvs: BaseUrlEnv[] = baseUrlEnv
        ? [{ envVar: baseUrlEnv, confidence: 'name-heuristic' }]
        : []
      return {
        service,
        category: hit.category,
        source: 'sdk' as const,
        evidence: hit.evidence,
        ...(baseUrlEnv ? { baseUrlEnv } : {}),
        ...(baseUrlEnvs.length > 0 ? { baseUrlEnvs } : {}),
      }
    })
}

// ---------------------------------------------------------------------------
// The HTTP half (item 63).
// ---------------------------------------------------------------------------

/** Everything one vendor's hosts contributed, before it becomes a service. */
interface HttpHit {
  refs: ExternalHttpRef[]
  hosts: Set<string>
}

/**
 * The third parties reached by plain HTTP: every URL literal in the tree, grouped by
 * REGISTRABLE DOMAIN, named after the domain minus its suffix. `ownHosts` and the
 * extractor's exclusion lists are the only filters — anything left is a host this
 * repo writes down and does not own.
 */
function detectHttpServices(
  fileAnalyses: readonly FileAnalysis[],
  ownHosts: readonly string[],
): DetectedExternalService[] {
  const owned = ownHosts.map((h) => h.toLowerCase())
  const isOwn = (host: string) => owned.some((o) => host === o || host.endsWith(`.${o}`))

  const hits = new Map<string, HttpHit>()
  // File order is the caller's; make the harvest order deterministic ourselves so
  // the FIRST base-URL env var of a service is the same one on every run.
  const refs = fileAnalyses
    .flatMap((file) => file.externalHttpRefs ?? [])
    .sort(byLocation)
  for (const ref of refs) {
    if (isOwn(ref.host)) continue
    const domain = registrableDomain(ref.host)
    if (!domain) continue
    const service = serviceNameFromDomain(domain)
    if (!service) continue
    const hit = hits.get(service) ?? { refs: [], hosts: new Set<string>() }
    hit.refs.push(ref)
    hit.hosts.add(ref.host)
    hits.set(service, hit)
  }

  // The name-only tier: a URL-ish env var read anywhere in the repo whose name
  // carries a token of a service we DID find a host for.
  const urlEnvReads = [...new Set(fileAnalyses.flatMap((file) => file.urlEnvReads ?? []))].sort()

  return [...hits.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([service, hit]) => {
      const baseUrlEnvs: BaseUrlEnv[] = []
      for (const ref of hit.refs) {
        if (!ref.envVar || baseUrlEnvs.some((e) => e.envVar === ref.envVar)) continue
        baseUrlEnvs.push({ envVar: ref.envVar, defaultUrl: ref.url, confidence: 'literal-fallback' })
      }
      const tokens = serviceTokens(service)
      for (const name of urlEnvReads) {
        if (baseUrlEnvs.some((e) => e.envVar === name)) continue
        const lower = name.toLowerCase()
        if (tokens.some((t) => lower.includes(t))) {
          baseUrlEnvs.push({ envVar: name, confidence: 'name-heuristic' })
        }
      }
      const evidence: ExternalServiceEvidence[] = []
      for (const ref of hit.refs) {
        if (evidence.length >= EVIDENCE_CAP) break
        if (evidence.some((e) => e.filePath === ref.location.filePath && e.url === ref.url)) continue
        evidence.push({ filePath: ref.location.filePath, url: ref.url })
      }
      return {
        service,
        source: 'http' as const,
        evidence,
        ...(baseUrlEnvs[0] ? { baseUrlEnv: baseUrlEnvs[0].envVar } : {}),
        ...(baseUrlEnvs.length > 0 ? { baseUrlEnvs } : {}),
      }
    })
}

function byLocation(a: ExternalHttpRef, b: ExternalHttpRef): number {
  return (
    a.location.filePath.localeCompare(b.location.filePath) ||
    a.location.startLine - b.location.startLine ||
    a.location.startColumn - b.location.startColumn
  )
}

/**
 * SDK ∪ HTTP, deduped by service name. An SDK hit WINS THE IDENTITY — it carries a
 * registry category and an import to point at, both of which the URL path lacks —
 * but the two evidence sets and base-URL env vars MERGE, because a repo that both
 * imports `stripe` and writes `https://api.stripe.com` in a config default has told
 * us two true things about the same service.
 */
function mergeDetections(
  sdk: readonly DetectedExternalService[],
  http: readonly DetectedExternalService[],
): DetectedExternalService[] {
  const byName = new Map(http.map((s) => [s.service, s]))
  const merged = sdk.map((s) => {
    const other = byName.get(s.service)
    if (!other) return s
    byName.delete(s.service)
    // Structural bindings first — a default URL beats a name that merely reads like one.
    const baseUrlEnvs = dedupeEnvs([...(other.baseUrlEnvs ?? []), ...(s.baseUrlEnvs ?? [])])
    return {
      ...s,
      evidence: [...s.evidence, ...other.evidence].slice(0, EVIDENCE_CAP),
      ...(baseUrlEnvs[0] ? { baseUrlEnv: baseUrlEnvs[0].envVar } : {}),
      ...(baseUrlEnvs.length > 0 ? { baseUrlEnvs } : {}),
    }
  })
  return [...merged, ...byName.values()].sort((a, b) => a.service.localeCompare(b.service))
}

/** First mention of each variable wins — callers pass the better tier first. */
function dedupeEnvs(entries: readonly BaseUrlEnv[]): BaseUrlEnv[] {
  const out: BaseUrlEnv[] = []
  for (const entry of entries) {
    if (out.some((e) => e.envVar === entry.envVar)) continue
    out.push(entry)
  }
  return out
}

/**
 * Whether the repo speaks raw HTTP itself (axios / requests / HttpClient …).
 * Separate from {@link detectExternalServices} on purpose: it is a transport fact,
 * not an identity — true for a repo that calls one unnamed partner API and for one
 * that calls none at all beyond its own services.
 */
export function usesRawHttpClient(fileAnalyses: readonly FileAnalysis[]): boolean {
  return fileAnalyses.some((file) =>
    file.imports.some((imp) =>
      importCandidates(imp.source).some((c) =>
        externalLayerPatterns.httpClients.some((client) => matchesPattern(c, client)),
      ),
    ),
  )
}
