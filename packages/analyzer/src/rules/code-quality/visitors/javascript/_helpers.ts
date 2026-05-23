/**
 * Shared helpers for code-quality JS/TS visitors.
 */

import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { SupportedLanguage } from '@truecourse/shared'

export const JS_LANGUAGES: SupportedLanguage[] = ['typescript', 'tsx', 'javascript']

export const TS_LANGUAGES: SupportedLanguage[] = ['typescript', 'tsx']

export type { SyntaxNode }

export const JS_FUNCTION_TYPES = ['function_declaration', 'function_expression', 'arrow_function', 'method_definition']

export function getFunctionBody(node: SyntaxNode): SyntaxNode | null {
  if (node.type === 'method_definition') {
    return node.namedChildren.find((c) => c.type === 'statement_block') ?? null
  }
  return node.childForFieldName('body')
}

export function getFunctionName(node: SyntaxNode): string {
  const nameNode = node.childForFieldName('name')
  return nameNode?.text || 'anonymous'
}

// Helper: extract regex source from a regex_pattern or string node
export function getRegexSource(node: SyntaxNode): string | null {
  if (node.type === 'regex') {
    const pattern = node.namedChildren.find((c) => c.type === 'regex_pattern')
    return pattern?.text ?? null
  }
  if (node.type === 'new_expression') {
    const ctor = node.childForFieldName('constructor')
    if (ctor?.text !== 'RegExp') return null
    const args = node.childForFieldName('arguments')
    const firstArg = args?.namedChildren[0]
    if (firstArg?.type === 'string') {
      return firstArg.text.slice(1, -1) // strip quotes
    }
  }
  return null
}

// Framework route conventions whose return type is fixed by the framework
// contract and almost never annotated in real codebases. Covers:
//   - Next.js App Router HTTP-method handlers and config exports.
//   - Remix / React Router v7 route module exports.
// Used by `missing-boundary-types` and `missing-return-type` to suppress
// FPs on framework-dictated names.
export const FRAMEWORK_ROUTE_EXPORT_NAMES: ReadonlySet<string> = new Set([
  // HTTP-method route handlers (Next.js App Router).
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS',
  // Remix / React Router v7 route module exports.
  'loader', 'action', 'clientLoader', 'clientAction',
  'meta', 'links', 'headers', 'shouldRevalidate',
  'HydrateFallback', 'ErrorBoundary',
  // Next.js App Router metadata / static-params helpers.
  'generateMetadata', 'generateStaticParams',
  'generateImageMetadata', 'generateViewport',
  'middleware',
])

// True when a `function_declaration` or `arrow_function` node belongs to
// an `export default` statement (e.g. Remix / Next.js page components).
export function isDefaultExportedFunction(node: SyntaxNode): boolean {
  const exportNode = node.parent
  if (!exportNode || exportNode.type !== 'export_statement') return false
  for (let i = 0; i < exportNode.childCount; i++) {
    if (exportNode.child(i)?.type === 'default') return true
  }
  return false
}

// True when a function body returns a JSX element / fragment. Used to skip
// React component default exports — TS infers `JSX.Element` and codebases
// almost never annotate it.
export function functionReturnsJsx(node: SyntaxNode): boolean {
  const JSX_NODE_TYPES = new Set(['jsx_element', 'jsx_self_closing_element', 'jsx_fragment'])
  const body = getFunctionBody(node)
  if (!body) return false
  // Arrow function with a JSX expression body (no statement_block).
  if (JSX_NODE_TYPES.has(body.type)) return true

  let found = false
  function walk(n: SyntaxNode) {
    if (found) return
    // Don't cross into nested functions.
    if (n.id !== node.id && JS_FUNCTION_TYPES.includes(n.type)) return
    if (n.type === 'return_statement') {
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && (JSX_NODE_TYPES.has(c.type) || (c.type === 'parenthesized_expression' && c.namedChild(0) && JSX_NODE_TYPES.has(c.namedChild(0)!.type)))) {
          found = true
          return
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) walk(c)
    }
  }
  walk(body)
  return found
}

// Magic numbers: exclude very common / obviously safe literals
export const MAGIC_NUMBER_WHITELIST = new Set([0, 1, 2, -1, 100, 1000])

// Common server/app port numbers that indicate hardcoding
export const COMMON_PORTS = new Set([80, 443, 3000, 3001, 3002, 3003, 4000, 4200, 5000, 5173, 7000, 7001, 8000, 8080, 8081, 8443, 9000, 9090, 9200, 9300])
