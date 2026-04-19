import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects functions where the return type annotation obviously mismatches
 * all return values. Heuristic-based — only flags when every return statement
 * returns a literal of a clearly incompatible type.
 *
 * Example:
 *   def get_name() -> int:
 *       return "hello"    # returns str, annotated int
 */
export const pythonReturnTypeInconsistentWithHintVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/return-type-inconsistent-with-hint',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const returnType = node.childForFieldName('return_type')
    if (!returnType) return null

    // Extract the annotation text
    const annotationText = extractAnnotationType(returnType)
    if (!annotationText) return null

    // Only check simple type annotations we can reason about
    const expectedKinds = ANNOTATION_TO_LITERAL_KINDS[annotationText]
    if (!expectedKinds) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    // Collect all return statements in this function (not nested functions)
    const returnStmts = collectReturnStatements(body)
    if (returnStmts.length === 0) return null

    // Check if ALL return statements return obviously wrong types
    const mismatches: SyntaxNode[] = []
    for (const ret of returnStmts) {
      const value = ret.namedChildren[0]
      if (!value) continue // bare `return` — compatible with None

      const literalKind = getLiteralKind(value)
      if (!literalKind) return null // can't determine type — bail out, don't report

      if (!expectedKinds.has(literalKind)) {
        mismatches.push(ret)
      }
    }

    // Only flag if ALL return statements are mismatched
    if (mismatches.length > 0 && mismatches.length === returnStmts.length) {
      const firstMismatch = mismatches[0]!
      return makeViolation(
        this.ruleKey,
        firstMismatch,
        filePath,
        'medium',
        'Return type inconsistent with type hint',
        `Function return type is annotated as \`${annotationText}\` but returns an incompatible value.`,
        sourceCode,
        `Fix the return value to match \`${annotationText}\` or update the type annotation.`,
      )
    }

    return null
  },
}

function extractAnnotationType(returnType: SyntaxNode): string | null {
  // tree-sitter wraps return_type in various nodes
  if (returnType.type === 'type') {
    const inner = returnType.namedChildren[0]
    return inner?.text || null
  }
  return returnType.text
}

type LiteralKind = 'int' | 'float' | 'str' | 'bool' | 'none' | 'list' | 'dict'

function getLiteralKind(node: SyntaxNode): LiteralKind | null {
  switch (node.type) {
    case 'integer': return 'int'
    case 'float': return 'float'
    case 'string':
    case 'concatenated_string': return 'str'
    case 'true':
    case 'false': return 'bool'
    case 'none': return 'none'
    case 'list': return 'list'
    case 'dictionary': return 'dict'
    default: return null
  }
}

const ANNOTATION_TO_LITERAL_KINDS: Record<string, Set<LiteralKind>> = {
  'int': new Set(['int', 'bool']),
  'float': new Set(['int', 'float', 'bool']),
  'str': new Set(['str']),
  'bool': new Set(['bool']),
  'list': new Set(['list']),
  'dict': new Set(['dict']),
  'None': new Set(['none']),
}

function collectReturnStatements(body: SyntaxNode): SyntaxNode[] {
  const results: SyntaxNode[] = []
  function walk(node: SyntaxNode) {
    // Don't descend into nested functions/classes
    if (node.type === 'function_definition' || node.type === 'class_definition') return
    if (node.type === 'return_statement') {
      results.push(node)
      return
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child) walk(child)
    }
  }
  walk(body)
  return results
}
