import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const prototypePollutionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/prototype-pollution',
  languages: JS_LANGUAGES,
  nodeTypes: ['assignment_expression', 'augmented_assignment_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    if (!left || left.type !== 'subscript_expression') return null

    // obj[key] = value — check if key is a dynamic variable (not a string literal)
    const index = left.childForFieldName('index')
    if (!index) return null

    // Only flag if the index is a variable (identifier), not a literal
    if (index.type !== 'identifier') return null

    // Check if the object is not an array type (heuristic: skip numeric-looking contexts)
    const obj = left.childForFieldName('object')
    if (!obj) return null

    // Skip React ref assignments: ref.current[index] = el
    if (obj.type === 'member_expression') {
      const objProp = obj.childForFieldName('property')
      if (objProp?.text === 'current') return null
    }

    // Skip when the key comes from Object.entries(), Object.keys(), or for...in over a local object.
    // These iterate controlled mapping objects, not user input.
    const keyName = index.text
    if (isKeyFromControlledIteration(node, keyName)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Prototype pollution',
      `\`${left.text}\` uses a dynamic key for property assignment — if \`${index.text}\` is \`"__proto__"\` or \`"constructor"\`, this enables prototype pollution.`,
      sourceCode,
      `Validate that \`${index.text}\` is not "__proto__", "constructor", or "prototype" before assignment, or use Map instead.`,
    )
  },
}

/**
 * Check if the key variable was destructured from Object.entries/Object.keys
 * or comes from a for...in loop over a local object.
 */
function isKeyFromControlledIteration(assignmentNode: SyntaxNode, keyName: string): boolean {
  let current: SyntaxNode | null = assignmentNode.parent
  while (current) {
    // for (const key in obj) — key iterates own property names of a local object
    if (current.type === 'for_in_statement') {
      const leftSide = current.childForFieldName('left')
      if (leftSide && leftSide.text.includes(keyName)) return true
    }
    // for (const [key, value] of Object.entries(obj))
    if (current.type === 'for_in_statement') {
      const rightSide = current.childForFieldName('right')
      if (rightSide && isObjectEntriesOrKeys(rightSide)) {
        const leftSide = current.childForFieldName('left')
        if (leftSide && leftSide.text.includes(keyName)) return true
      }
    }
    current = current.parent
  }
  return false
}

function isObjectEntriesOrKeys(node: SyntaxNode): boolean {
  if (node.type === 'call_expression') {
    const fn = node.childForFieldName('function')
    if (fn?.type === 'member_expression') {
      const obj = fn.childForFieldName('object')
      const prop = fn.childForFieldName('property')
      if (obj?.text === 'Object' && (prop?.text === 'entries' || prop?.text === 'keys')) {
        return true
      }
    }
  }
  return false
}
