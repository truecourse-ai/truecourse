import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects assignments where the value is an obvious mismatch with the
 * type annotation. Without a full type checker, we catch clear cases:
 *
 *   x: int = "hello"       # string assigned to int
 *   y: str = 42             # int assigned to str
 *   z: bool = "yes"         # string assigned to bool
 *   w: float = "nope"       # string assigned to float
 *   v: list = 42            # int assigned to list
 *
 * Only flags when both the annotation and the value are simple literals
 * that obviously mismatch.
 */
export const pythonAssignmentInconsistentWithHintVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/assignment-inconsistent-with-hint',
  languages: ['python'],
  nodeTypes: ['assignment'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    const typeNode = node.childForFieldName('type')
    if (!left || !right || !typeNode) return null

    // Extract the annotation text — could be wrapped in `type` node
    const annotationText = extractAnnotationText(typeNode)
    if (!annotationText) return null

    // Determine the literal kind of the RHS
    const literalKind = getLiteralKind(right)
    if (!literalKind) return null

    // Check for obvious mismatches
    const mismatch = checkMismatch(annotationText, literalKind)
    if (!mismatch) return null

    return makeViolation(
      this.ruleKey,
      node,
      filePath,
      'medium',
      'Assignment inconsistent with type hint',
      `Variable \`${left.text}\` is annotated as \`${annotationText}\` but assigned a ${literalKind} value.`,
      sourceCode,
      `Change the value to match \`${annotationText}\` or fix the type annotation.`,
    )
  },
}

function extractAnnotationText(typeNode: SyntaxNode): string | null {
  // tree-sitter Python wraps annotations in a `type` node
  if (typeNode.type === 'type') {
    const inner = typeNode.namedChildren[0]
    return inner?.text || null
  }
  return typeNode.text
}

type LiteralKind = 'int' | 'float' | 'str' | 'bool' | 'none' | 'list' | 'dict' | 'set' | 'tuple' | 'bytes'

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
    case 'set': return 'set'
    case 'tuple': return 'tuple'
    default: return null
  }
}

/** Simple type hint → literal kind compatibility check. */
function checkMismatch(annotation: string, literal: LiteralKind): boolean {
  // Normalize: strip Optional, | None for simple cases
  const clean = annotation.trim()

  // Map annotation to expected literal kinds
  const COMPAT: Record<string, Set<LiteralKind>> = {
    'int': new Set(['int', 'bool']),  // bool is subtype of int
    'float': new Set(['int', 'float', 'bool']),
    'str': new Set(['str']),
    'bool': new Set(['bool']),
    'list': new Set(['list']),
    'dict': new Set(['dict']),
    'set': new Set(['set']),
    'tuple': new Set(['tuple']),
    'bytes': new Set(['bytes']),
  }

  const allowed = COMPAT[clean]
  if (!allowed) return false // unknown annotation, don't flag

  // None is compatible with Optional types — don't flag
  if (literal === 'none') return false

  return !allowed.has(literal)
}
