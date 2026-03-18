import type { Tree } from 'tree-sitter'
import type { SyntaxNode } from 'tree-sitter'
import type { AnalysisRule, CodeViolation } from '@truecourse/shared'
import { ALL_CODE_VISITORS } from './code-rule-visitor.js'

/**
 * Check code-level rules by walking the AST and firing matching visitors.
 */
export function checkCodeRules(
  tree: Tree,
  filePath: string,
  sourceCode: string,
  enabledRules: AnalysisRule[],
): CodeViolation[] {
  const enabledKeys = new Set(
    enabledRules
      .filter((r) => r.category === 'code' && r.type === 'deterministic' && r.enabled)
      .map((r) => r.key),
  )

  if (enabledKeys.size === 0) return []

  // Build visitors list filtered by enabled rules
  const activeVisitors = ALL_CODE_VISITORS.filter((v) => enabledKeys.has(v.ruleKey))
  if (activeVisitors.length === 0) return []

  // Build nodeType → visitors lookup
  const visitorsByNodeType = new Map<string, typeof activeVisitors>()
  for (const visitor of activeVisitors) {
    for (const nodeType of visitor.nodeTypes) {
      let list = visitorsByNodeType.get(nodeType)
      if (!list) {
        list = []
        visitorsByNodeType.set(nodeType, list)
      }
      list.push(visitor)
    }
  }

  const violations: CodeViolation[] = []

  // Walk entire tree recursively
  function walk(node: SyntaxNode) {
    const visitors = visitorsByNodeType.get(node.type)
    if (visitors) {
      for (const visitor of visitors) {
        const violation = visitor.visit(node, filePath, sourceCode)
        if (violation) {
          violations.push(violation)
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child) walk(child)
    }
  }

  walk(tree.rootNode)
  return violations
}
