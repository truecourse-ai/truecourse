import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const misleadingArrayReverseVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/misleading-array-reverse',
  languages: JS_LANGUAGES,
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const prop = fn.childForFieldName('property')
    if (!prop || (prop.text !== 'reverse' && prop.text !== 'sort')) return null

    const obj = fn.childForFieldName('object')
    if (!obj) return null

    // Only flag if: the result of calling reverse/sort is assigned to a variable
    // and the receiver is a simple identifier (so the original is also mutated)
    const parent = node.parent
    if (!parent) return null

    // Flag when: const x = arr.reverse() or let x = arr.sort(...)
    // i.e., parent is variable_declarator or assignment_expression right-hand side
    if (
      (parent.type === 'variable_declarator' && parent.childForFieldName('value')?.id === node.id) ||
      (parent.type === 'assignment_expression' && parent.childForFieldName('right')?.id === node.id)
    ) {
      if (obj.type === 'identifier') {
        // Check if the original array variable is referenced after this assignment
        // in the same scope. If not used again, the mutation is harmless.
        if (!isUsedAfterNode(obj.text, node)) return null

        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Misleading array mutation',
          `\`${obj.text}.${prop.text}()\` mutates \`${obj.text}\` in place AND returns it. Assigning the result looks non-mutating but the original \`${obj.text}\` is also changed.`,
          sourceCode,
          `Use \`[...${obj.text}].${prop.text}()\` or \`${obj.text}.${prop.text === 'sort' ? 'toSorted' : 'toReversed'}()\` (ES2023) to avoid mutating the original.`,
        )
      }
    }

    return null
  },
}

/**
 * Check if a variable name is referenced after the given node in the same scope.
 */
function isUsedAfterNode(varName: string, callNode: SyntaxNode): boolean {
  // Find the enclosing scope (function body or program)
  let scope: SyntaxNode | null = callNode.parent
  while (scope && scope.type !== 'statement_block' && scope.type !== 'program') {
    scope = scope.parent
  }
  if (!scope) return true // assume used if we can't determine scope

  // Find all identifier nodes in the scope that match the variable name
  // and appear AFTER the call node
  const callEnd = callNode.endIndex
  let found = false

  function scan(n: SyntaxNode) {
    if (found) return
    // Don't recurse into nested function scopes
    if (n.startIndex > callNode.startIndex &&
        (n.type === 'function_declaration' || n.type === 'function' ||
         n.type === 'arrow_function' || n.type === 'method_definition')) return
    if (n.type === 'identifier' && n.text === varName && n.startIndex > callEnd) {
      // Make sure it's not the left side of the same assignment or declaration
      const p = n.parent
      if (p?.type === 'variable_declarator' && p.childForFieldName('name')?.id === n.id) return
      if (p?.type === 'assignment_expression' && p.childForFieldName('left')?.id === n.id) return
      found = true
      return
    }
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i)
      if (child) scan(child)
    }
  }

  scan(scope)
  return found
}
