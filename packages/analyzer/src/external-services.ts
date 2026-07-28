/**
 * EXTERNAL-SERVICE DETECTION — which named third parties the repo imports.
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
 * What it deliberately does NOT report:
 * - Generic HTTP clients (axios, requests, HttpClient). A transport is not a
 *   service identity — "blocked on axios" tells a reader nothing. Ask
 *   {@link usesRawHttpClient} separately when the transport itself is the point.
 * - The registry's `filePatterns` (`**\/integrations/**` &c). A path convention
 *   says a file is integration-shaped; it never names WHICH third party.
 */

import type { DetectedExternalService, ExternalServiceCategory, ExternalServiceEvidence, FileAnalysis } from '@truecourse/shared'
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
 * The named third parties `fileAnalyses` imports, sorted by service name so the
 * result is stable across runs (file discovery order is not part of the identity).
 */
export function detectExternalServices(fileAnalyses: readonly FileAnalysis[]): DetectedExternalService[] {
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
      return {
        service,
        category: hit.category,
        evidence: hit.evidence,
        ...(baseUrlEnv ? { baseUrlEnv } : {}),
      }
    })
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
