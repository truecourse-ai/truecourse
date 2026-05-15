import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getFunctionBody, type SyntaxNode } from './_helpers.js'

// Skip the empty parenthesized_expression / type_assertion wrappers when
// walking up the parent chain to classify an arrow's structural role.
function unwrapParens(node: SyntaxNode | null): SyntaxNode | null {
  let cur = node
  while (cur && (cur.type === 'parenthesized_expression' || cur.type === 'type_assertion' || cur.type === 'as_expression' || cur.type === 'satisfies_expression' || cur.type === 'non_null_expression')) {
    cur = cur.parent
  }
  return cur
}

// True when `node` is an empty arrow_function used as a required no-op
// callback shape that API contracts demand (e.g. `(onSave ?? (async () => {}))`,
// `return () => {}` for useSyncExternalStore subscribe, or
// `markAuthenticated: () => {}` in a `createContext` defaults object).
function isRequiredNoopShape(node: SyntaxNode): boolean {
  if (node.type !== 'arrow_function') return false
  const parent = unwrapParens(node.parent)
  if (!parent) return false

  // `x ?? (() => {})` / `x || (() => {})` — fallback default for optional callback
  if (parent.type === 'binary_expression') {
    const op = parent.childForFieldName('operator')?.text
    if (op === '??' || op === '||') {
      const right = parent.childForFieldName('right')
      // Walk through parens to find the empty arrow on the right side
      const unwrappedRight = right ? walkThroughParens(right) : null
      if (unwrappedRight && unwrappedRight.id === node.id) return true
    }
  }

  // `return () => {}` — returning a no-op (e.g. unsubscribe for useSyncExternalStore subscribe)
  if (parent.type === 'return_statement') return true

  // `() => () => {}` — arrow whose entire body IS this empty arrow
  // (concise-arrow form of returning a no-op unsubscribe)
  if (parent.type === 'arrow_function') {
    const parentBody = parent.childForFieldName('body')
    if (parentBody && parentBody.id === node.id) return true
  }

  // `{ key: () => {} }` — object pair value: required-prop no-op in a config/defaults object
  // (e.g. DataTable({ onPageChange: () => {} }), createContext({ markAuthenticated: () => {} }))
  if (parent.type === 'pair') {
    const value = parent.childForFieldName('value')
    if (value && value.id === node.id) return true
  }

  return false
}

function walkThroughParens(node: SyntaxNode): SyntaxNode {
  let cur: SyntaxNode = node
  while (cur.type === 'parenthesized_expression') {
    const inner = cur.namedChildren.find((c) => c !== null)
    if (!inner) break
    cur = inner
  }
  return cur
}

// True when `node` is a `private`/`protected` constructor — the empty body
// is the canonical singleton/abstract-class pattern, not a missing impl.
function isAccessRestrictedConstructor(node: SyntaxNode): boolean {
  if (node.type !== 'method_definition') return false
  const nameNode = node.childForFieldName('name')
  if (nameNode?.text !== 'constructor') return false
  // method_definition may have an accessibility_modifier child
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)
    if (child?.type === 'accessibility_modifier') {
      const txt = child.text
      if (txt === 'private' || txt === 'protected') return true
    }
  }
  return false
}

export const jsNoEmptyFunctionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-empty-function',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['function_declaration', 'function_expression', 'arrow_function', 'method_definition'],
  visit(node, filePath, sourceCode) {
    const bodyNode = getFunctionBody(node)
    if (!bodyNode || bodyNode.type !== 'statement_block') return null

    if (bodyNode.namedChildren.length > 0) return null

    for (let i = 0; i < bodyNode.childCount; i++) {
      const child = bodyNode.child(i)
      if (child && child.type === 'comment') return null
    }

    // Skip private/protected constructors — singleton/abstract-class pattern.
    if (isAccessRestrictedConstructor(node)) return null

    // Skip empty functions inside .catch() — intentional no-op error suppression
    const parent = node.parent
    if (parent?.type === 'arguments') {
      const grandparent = parent.parent
      if (grandparent?.type === 'call_expression') {
        const gpFn = grandparent.childForFieldName('function')
        if (gpFn?.type === 'member_expression') {
          const gpProp = gpFn.childForFieldName('property')
          if (gpProp?.text === 'catch') return null
        }
      }
    }

    // Skip arrow_functions used in required-no-op API shapes:
    //   - `x ?? (async () => {})` / `x || (() => {})` — optional callback fallback
    //   - `return () => {}` / `() => () => {}` — returned no-op (e.g. useSyncExternalStore unsubscribe)
    //   - `{ key: () => {} }` — required-prop no-op in object literal (config / context defaults)
    if (isRequiredNoopShape(node)) return null

    const nameNode = node.childForFieldName('name')
    const name = nameNode?.text || 'anonymous'

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Empty function body',
      `Function \`${name}\` has an empty body. Add an implementation or a comment explaining why it's empty.`,
      sourceCode,
      'Add an implementation, throw a "not implemented" error, or add a comment explaining why the body is empty.',
    )
  },
}
