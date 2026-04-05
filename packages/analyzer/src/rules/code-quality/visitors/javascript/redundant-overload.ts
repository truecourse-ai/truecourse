import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects consecutive TypeScript function overload signatures that could be
 * unified with optional parameters. If two overloads differ only by one
 * parameter being present/absent, they can be collapsed into one with `param?:`.
 *
 * TypeScript overload signatures (without body) appear as `function_signature`
 * nodes in tree-sitter-typescript.
 */

interface ParamInfo {
  typeText: string
}

function getParams(node: SyntaxNode): ParamInfo[] | null {
  const params = node.childForFieldName('parameters')
  if (!params) return null
  return params.namedChildren
    .filter((p) => p.type !== 'comment')
    .map((p) => {
      const typeAnnotation = p.childForFieldName('type')?.text ?? ''
      return { typeText: typeAnnotation }
    })
}

function getFunctionName(node: SyntaxNode): string | null {
  return node.childForFieldName('name')?.text ?? null
}

function getReturnType(node: SyntaxNode): string {
  return node.childForFieldName('return_type')?.text ?? ''
}

function canUnify(a: ParamInfo[], b: ParamInfo[]): boolean {
  // They must differ by exactly one parameter
  if (Math.abs(a.length - b.length) !== 1) return false

  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a]

  // All params in the shorter list must match the corresponding params in the longer list
  for (let i = 0; i < shorter.length; i++) {
    if (shorter[i].typeText !== longer[i].typeText) return false
  }

  return true
}

export const redundantOverloadVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/redundant-overload',
  languages: ['typescript', 'tsx'],
  // function_signature = overload without body (TypeScript-specific node type)
  nodeTypes: ['function_signature'],
  visit(node, filePath, sourceCode) {
    const name = getFunctionName(node)
    if (!name) return null

    // Look at the next sibling to see if it's also a function_signature with the same name
    const parent = node.parent
    if (!parent) return null

    const siblings = parent.namedChildren
    const idx = siblings.findIndex((s) => s.id === node.id)
    if (idx < 0 || idx + 1 >= siblings.length) return null

    const next = siblings[idx + 1]
    if (!next || next.type !== 'function_signature') return null
    if (getFunctionName(next) !== name) return null

    // Same return type?
    if (getReturnType(node) !== getReturnType(next)) return null

    const paramsA = getParams(node)
    const paramsB = getParams(next)
    if (!paramsA || !paramsB) return null

    if (!canUnify(paramsA, paramsB)) return null

    return makeViolation(
      this.ruleKey,
      node,
      filePath,
      'low',
      'Redundant function overload',
      `Overloads for \`${name}\` differ only by an optional parameter — they can be unified into one signature with \`param?\`.`,
      sourceCode,
      'Merge the two overloads into a single signature using an optional parameter.',
    )
  },
}
