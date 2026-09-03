/**
 * THE OPENAPI META READER — the REST address an RPC procedure also answers at,
 * declared beside the procedure instead of in any route table.
 *
 * `trpc-to-openapi` (and its predecessor `trpc-openapi`) expose a tRPC tree as a
 * REST API by reading an `openapi: { method, path }` meta off each procedure:
 *
 *     export const distributeEnvelopeMeta: TrpcRouteMeta = {
 *       openapi: { method: 'POST', path: '/envelope/distribute', … },
 *     }
 *     export const distributeEnvelopeRoute = authenticatedProcedure
 *       .meta(distributeEnvelopeMeta)
 *       .mutation(…)
 *
 * There is no `router.post('/envelope/distribute', …)` anywhere — the address
 * exists only in that literal, so a reader of route CALLS sees none of it. On
 * documenso the whole public API is 89 such metas and zero registrations.
 *
 * What this reader takes as an operation is deliberately just the LITERAL, not
 * the procedure it is attached to. The meta declares the address and the verb on
 * its own; linking it back to a procedure would need cross-file constant
 * resolution (documenso keeps the meta in a sibling `*.types.ts`) and would buy
 * nothing an address needs. The path is relative — the mapper composes it with
 * the base the app serves its OpenAPI document at.
 *
 * Per-file and pure, like every extractor here: this module never decides where
 * the surface is mounted, only what it declares.
 */

import type { Node as SyntaxNode, Tree } from 'web-tree-sitter'
import type { OpenApiRouteMeta, SupportedLanguage } from '@truecourse/shared'
import { extractStringLiteral } from './route-registrations.js'

/**
 * The verbs `GuardHttpRequestSchema` can actually issue. A meta naming anything
 * else (`TRACE`, `HEAD`) yields no operation rather than a request no runner can
 * make — the same closed-verb rule the RPC derivation applies to subscriptions.
 */
const META_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const)

type MetaMethod = OpenApiRouteMeta['httpMethod']

/** The idiom is a JavaScript one; no other language ships it. */
const META_LANGUAGES = new Set<SupportedLanguage>(['typescript', 'tsx', 'javascript'])

/** Cosmetic label keys, in preference order. Never part of an address. */
const LABEL_KEYS = ['summary', 'operationId'] as const

/**
 * Every `openapi: {…}` operation literal in the file, in source order.
 *
 * The gate is the literal's own shape: an `openapi` value that is an object
 * carrying BOTH a string `method` this runner knows and a string `path` that
 * looks like a route path. That rejects the other common `openapi` key — a
 * document config (`{ openapi: { title, version } }`, `{ openapi: true }`) —
 * without a blocklist of library names.
 */
export function extractOpenApiRouteMetas(
  tree: Tree,
  filePath: string,
  language: SupportedLanguage,
): OpenApiRouteMeta[] {
  if (!META_LANGUAGES.has(language)) return []

  const metas: OpenApiRouteMeta[] = []
  const cursor = tree.walk()

  function traverse(): void {
    const node = cursor.currentNode
    if (node.type === 'pair' && keyName(node) === 'openapi') {
      const value = node.childForFieldName('value')
      const meta = value ? readOperation(value, filePath, node) : null
      if (meta) metas.push(meta)
    }

    if (cursor.gotoFirstChild()) {
      do { traverse() } while (cursor.gotoNextSibling())
      cursor.gotoParent()
    }
  }

  traverse()
  return metas
}

/** The property name a `pair` declares, quoted or not. */
function keyName(pair: SyntaxNode): string | null {
  const key = pair.childForFieldName('key')
  if (!key) return null
  if (key.type === 'property_identifier' || key.type === 'identifier') return key.text
  return extractStringLiteral(key)
}

function readOperation(value: SyntaxNode, filePath: string, pair: SyntaxNode): OpenApiRouteMeta | null {
  if (value.type !== 'object') return null

  const fields = new Map<string, SyntaxNode>()
  for (let i = 0; i < value.namedChildCount; i++) {
    const child = value.namedChild(i)
    if (!child || child.type !== 'pair') continue
    const name = keyName(child)
    const fieldValue = child.childForFieldName('value')
    if (name && fieldValue) fields.set(name, fieldValue)
  }

  const methodNode = fields.get('method')
  const pathNode = fields.get('path')
  if (!methodNode || !pathNode) return null

  const rawMethod = extractStringLiteral(methodNode)
  const path = extractStringLiteral(pathNode)
  if (!rawMethod || !path) return null

  const method = rawMethod.trim().toUpperCase()
  if (!META_METHODS.has(method as MetaMethod)) return null
  // A path template's `{id}` is an address; a `${id}` is not — an interpolated
  // literal reads as the text around the hole, which would name a route nobody
  // serves. `extractStringLiteral` already refuses those template strings.
  if (!path.startsWith('/')) return null

  const label = readLabel(fields)

  return {
    httpMethod: method as MetaMethod,
    path,
    ...(label ? { label } : {}),
    location: {
      filePath,
      startLine: pair.startPosition.row + 1,
      endLine: pair.endPosition.row + 1,
      startColumn: pair.startPosition.column,
      endColumn: pair.endPosition.column,
    },
  }
}

function readLabel(fields: Map<string, SyntaxNode>): string | null {
  for (const key of LABEL_KEYS) {
    const node = fields.get(key)
    const text = node ? extractStringLiteral(node) : null
    if (text) return text
  }
  return null
}
