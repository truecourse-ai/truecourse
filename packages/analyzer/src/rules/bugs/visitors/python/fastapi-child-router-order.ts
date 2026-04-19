import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detect: app.include_router(child) called before app.include_router(parent)
// where parent router has the same prefix as child
// Simpler heuristic: multiple include_router calls where a more-specific prefix comes after a less-specific prefix

interface RouterInclude {
  node: SyntaxNode
  prefix: string | null
}

function extractPrefix(callNode: SyntaxNode): string | null {
  const args = callNode.childForFieldName('arguments')
  if (!args) return null
  const kwArgs = args.namedChildren.filter(c => c.type === 'keyword_argument')
  const prefixKw = kwArgs.find(k => k.childForFieldName('name')?.text === 'prefix')
  if (!prefixKw) return null
  const val = prefixKw.childForFieldName('value')
  if (!val) return null
  let text = val.text.replace(/^['"]|['"]$/g, '')
  return text
}

function isIncludeRouterCall(node: SyntaxNode): boolean {
  const fn = node.childForFieldName('function')
  if (!fn || fn.type !== 'attribute') return false
  const attr = fn.childForFieldName('attribute')
  return attr?.text === 'include_router'
}

export const pythonFastapiChildRouterOrderVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/fastapi-child-router-order',
  languages: ['python'],
  nodeTypes: ['module'],
  visit(node, filePath, sourceCode) {
    // Collect all include_router calls in order
    const includes: RouterInclude[] = []

    function walk(n: SyntaxNode) {
      if (n.type === 'call' && isIncludeRouterCall(n)) {
        const prefix = extractPrefix(n)
        includes.push({ node: n, prefix })
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child)
      }
    }
    walk(node)

    if (includes.length < 2) return null

    // Check if any less-specific prefix comes after a more-specific one that starts with it
    for (let i = 0; i < includes.length; i++) {
      for (let j = i + 1; j < includes.length; j++) {
        const earlier = includes[i]
        const later = includes[j]
        if (!earlier.prefix || !later.prefix) continue
        // If earlier prefix is a prefix of later (i.e. later is more specific and came after)
        // AND they're from the same app
        if (later.prefix.startsWith(earlier.prefix) && later.prefix !== earlier.prefix) {
          return makeViolation(
            this.ruleKey, later.node, filePath, 'high',
            'FastAPI child router included after parent',
            `Router with prefix \`${later.prefix}\` is included after parent router \`${earlier.prefix}\` — FastAPI matches routes in registration order, so child routes may be shadowed.`,
            sourceCode,
            'Include more-specific (child) routers before less-specific (parent) routers.',
          )
        }
      }
    }
    return null
  },
}
