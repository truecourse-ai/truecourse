import type { SyntaxNode } from 'tree-sitter'
import type { Tree } from 'tree-sitter'
import type { CodeViolation, SupportedLanguage } from '@truecourse/shared'
import { buildDataFlowContext } from '../data-flow/index.js'
import type { DataFlowContext } from '../data-flow/index.js'
import type { TypeQueryService } from '../ts-compiler.js'

export interface CodeRuleVisitor {
  ruleKey: string
  nodeTypes: string[]
  languages?: SupportedLanguage[]
  needsDataFlow?: boolean
  needsTypeQuery?: boolean
  visit(node: SyntaxNode, filePath: string, sourceCode: string, dataFlow?: DataFlowContext, typeQuery?: TypeQueryService): CodeViolation | null
}

export function makeViolation(
  ruleKey: string,
  node: SyntaxNode,
  filePath: string,
  severity: string,
  title: string,
  content: string,
  sourceCode: string,
  fixPrompt?: string,
): CodeViolation {
  const lineStart = node.startPosition.row + 1
  const lineEnd = node.endPosition.row + 1
  const lines = sourceCode.split('\n')
  const snippetLines = lines.slice(node.startPosition.row, Math.min(node.endPosition.row + 1, node.startPosition.row + 3))
  const snippet = snippetLines.join('\n')

  return {
    ruleKey,
    filePath,
    lineStart,
    lineEnd,
    columnStart: node.startPosition.column,
    columnEnd: node.endPosition.column,
    severity,
    title,
    content,
    snippet,
    fixPrompt,
  }
}

/**
 * Walk an AST tree and fire matching visitors, returning all violations found.
 * Shared by all domain checkers that have AST-level rules.
 */
export function walkAstWithVisitors(
  tree: Tree,
  filePath: string,
  sourceCode: string,
  visitors: CodeRuleVisitor[],
  enabledRuleKeys: Set<string>,
  language?: SupportedLanguage,
  typeQuery?: TypeQueryService,
): CodeViolation[] {
  // Filter visitors by enabled rules and language
  const activeVisitors = visitors.filter((v) => {
    if (!enabledRuleKeys.has(v.ruleKey)) return false
    if (v.languages && language && !v.languages.includes(language)) return false
    return true
  })
  if (activeVisitors.length === 0) return []

  // Build data flow context if any active visitor needs it
  let dataFlow: DataFlowContext | undefined
  if (language && activeVisitors.some((v) => v.needsDataFlow)) {
    dataFlow = buildDataFlowContext(tree.rootNode, language)
  }

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

  function walk(node: SyntaxNode) {
    const visitors = visitorsByNodeType.get(node.type)
    if (visitors) {
      for (const visitor of visitors) {
        const violation = visitor.visit(node, filePath, sourceCode, visitor.needsDataFlow ? dataFlow : undefined, visitor.needsTypeQuery ? typeQuery : undefined)
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
