import type { Node as SyntaxNode } from 'web-tree-sitter'
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

    // Skip when the key was computed from a local helper call in the same
    // function scope - e.g. `const key = composeBucketKey(a, b)`. Helpers
    // that compose app-controlled identifiers don't admit `__proto__` /
    // `constructor` short of an unrelated bug, and the rule has no way to
    // reach into the helper to reason about what it returns.
    if (isKeyAssignedFromLocalCall(node, keyName)) return null

    // Skip when the key is a destructured parameter: `forEach(([key, val]) =>
    // out[key] = val)`. The destructuring pattern means the key was iterated
    // from a structured value the caller composed, not pulled directly from
    // user input. Same reasoning as the local-call case: without inter-
    // procedural taint, the rule has no way to see whether the iterable's
    // keys could be `__proto__`, and firing on every iteration loop is
    // ~100% noise.
    if (isKeyDestructuredParam(node, keyName)) return null

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

// True if the key variable's name appears as a direct child of an
// array_pattern or object_pattern in some enclosing arrow / function /
// method's parameter list. `(([key, val]) => out[key] = val)` matches.
function isKeyDestructuredParam(assignmentNode: SyntaxNode, keyName: string): boolean {
  let scope: SyntaxNode | null = assignmentNode.parent
  while (scope) {
    if (
      scope.type === 'function_declaration' ||
      scope.type === 'function_expression' ||
      scope.type === 'arrow_function' ||
      scope.type === 'method_definition'
    ) {
      const params = scope.childForFieldName('parameters') ?? scope.childForFieldName('parameter')
      if (params && containsDestructuredName(params, keyName)) return true
    }
    if (scope.type === 'program') break
    scope = scope.parent
  }
  return false
}

function containsDestructuredName(params: SyntaxNode, keyName: string): boolean {
  let found = false
  function walk(n: SyntaxNode): void {
    if (found) return
    if (n.type === 'identifier' && n.text === keyName) {
      const parent = n.parent
      if (parent?.type === 'array_pattern' || parent?.type === 'object_pattern') {
        found = true
        return
      }
      // Shorthand: `({ key })` lifts the identifier directly into
      // shorthand_property_identifier_pattern.
      if (parent?.type === 'shorthand_property_identifier_pattern' && n.text === keyName) {
        found = true
        return
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i)
      if (child) walk(child)
    }
  }
  walk(params)
  return found
}

// True if the key variable was declared in an enclosing function scope as
// `const | let | var keyName = <call_expression>(...)`. The result of a
// local helper call is treated as internally-derived (not user input) and
// the rule suppresses to avoid noise on `state[key] = ...` patterns where
// `key` is composed from app-controlled identifiers.
function isKeyAssignedFromLocalCall(assignmentNode: SyntaxNode, keyName: string): boolean {
  let scope: SyntaxNode | null = assignmentNode.parent
  while (scope) {
    if (
      scope.type === 'function_declaration' ||
      scope.type === 'function_expression' ||
      scope.type === 'arrow_function' ||
      scope.type === 'method_definition' ||
      scope.type === 'program'
    ) break
    scope = scope.parent
  }
  if (!scope) return false

  let found = false
  function walk(n: SyntaxNode): void {
    if (found) return
    if (n.type === 'variable_declarator') {
      const name = n.childForFieldName('name')
      const value = n.childForFieldName('value')
      if (name?.type === 'identifier' && name.text === keyName && value?.type === 'call_expression') {
        found = true
        return
      }
    }
    // Don't descend into nested function bodies — they can't shadow the key
    // we're looking for in this enclosing scope.
    if (
      n !== scope &&
      (n.type === 'function_declaration' ||
        n.type === 'function_expression' ||
        n.type === 'arrow_function' ||
        n.type === 'method_definition')
    ) return
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i)
      if (child) walk(child)
    }
  }
  walk(scope)
  return found
}
