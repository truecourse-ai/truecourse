import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('tree-sitter').SyntaxNode

function collectNames(pattern: SyntaxNode): string[] {
  if (pattern.type === 'identifier') return [pattern.text]
  if (pattern.type === 'tuple_pattern' || pattern.type === 'list_pattern' || pattern.type === 'pattern_list') {
    return pattern.namedChildren.flatMap(collectNames)
  }
  return []
}

function countUsages(name: string, scope: SyntaxNode, skipNode: SyntaxNode): number {
  let count = 0
  function walk(n: SyntaxNode) {
    if (n === skipNode) return
    if (n.type === 'identifier' && n.text === name) {
      // Check it's not part of a declaration
      const p = n.parent
      if (p?.type === 'assignment' && p.childForFieldName('left') === n) return
      count++
    }
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i)
      if (child) walk(child)
    }
  }
  walk(scope)
  return count
}

export const pythonUnusedUnpackedVariableVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unused-unpacked-variable',
  languages: ['python'],
  nodeTypes: ['expression_statement'],
  visit(node, filePath, sourceCode) {
    const expr = node.namedChildren[0]
    if (!expr || expr.type !== 'assignment') return null

    const left = expr.childForFieldName('left')
    if (!left) return null

    // Only check tuple unpacking: a, b = ...
    if (left.type !== 'tuple_pattern' && left.type !== 'pattern_list') return null

    const names = collectNames(left)
    if (names.length === 0) return null

    // Get the enclosing scope
    let scope: SyntaxNode | null = node.parent
    while (scope && scope.type !== 'block' && scope.type !== 'module') {
      scope = scope.parent
    }
    if (!scope) return null

    const unusedNames: string[] = []
    for (const name of names) {
      if (name.startsWith('_')) continue // Convention: _ prefix means intentionally unused
      const usages = countUsages(name, scope, node)
      if (usages === 0) {
        unusedNames.push(name)
      }
    }

    if (unusedNames.length === 0) return null

    return makeViolation(
      this.ruleKey, left, filePath, 'low',
      `Unused unpacked variable: ${unusedNames.join(', ')}`,
      `Unpacked variable(s) \`${unusedNames.join(', ')}\` are never used — prefix with \`_\` if intentional.`,
      sourceCode,
      `Rename unused variables with \`_\` prefix: \`_${unusedNames[0]}\`.`,
    )
  },
}
