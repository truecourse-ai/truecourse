import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('web-tree-sitter').Node

function collectNames(pattern: SyntaxNode): string[] {
  if (pattern.type === 'identifier') return [pattern.text]
  if (pattern.type === 'tuple_pattern' || pattern.type === 'list_pattern' || pattern.type === 'pattern_list') {
    return pattern.namedChildren.flatMap(collectNames)
  }
  return []
}

function countUsages(name: string, scope: SyntaxNode, skipNode: SyntaxNode): number {
  let count = 0
  // Compare by `node.id`, not by SyntaxNode identity — tree-sitter returns a
  // fresh proxy on every access, so `n === skipNode` is non-deterministic.
  const skipId = skipNode.id
  function walk(n: SyntaxNode) {
    if (n.id === skipId) return
    if (n.type === 'identifier' && n.text === name) {
      // Check it's not part of a declaration
      const p = n.parent
      if (p?.type === 'assignment' && p.childForFieldName('left')?.id === n.id) return
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

    // Get the enclosing function/module scope — NOT just the nearest block.
    // Python has function-level scoping, so a variable assigned in an inner
    // block (if/for/with/try) is visible in the entire enclosing function.
    let scope: SyntaxNode | null = node.parent
    while (scope) {
      if (scope.type === 'module') break
      if (scope.type === 'block') {
        // Only stop at a function/class body block, not inner control-flow blocks
        const blockParent = scope.parent
        if (
          blockParent?.type === 'function_definition' ||
          blockParent?.type === 'class_definition' ||
          blockParent?.type === 'module'
        ) {
          break
        }
      }
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
