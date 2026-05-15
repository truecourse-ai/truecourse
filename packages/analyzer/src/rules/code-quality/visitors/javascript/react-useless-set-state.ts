import type { SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const FUNCTION_TYPES = new Set([
  'function_declaration',
  'function_expression',
  'arrow_function',
  'method_definition',
  'generator_function',
  'generator_function_declaration',
])

/**
 * Check whether the identifier `name` is bound by anything other than the
 * destructured useState return — i.e. a function parameter or a local
 * variable declaration that shadows the state variable's name. If so, the
 * argument to `setX(x)` refers to that shadowing binding (which can hold a
 * freshly computed value), not the current state, and the rule should not
 * fire.
 */
function isShadowedAtCall(callNode: SyntaxNode, name: string): boolean {
  let cur: SyntaxNode | null = callNode.parent

  while (cur) {
    // Function-like ancestor: check its parameters for a binding of `name`.
    if (FUNCTION_TYPES.has(cur.type)) {
      const params =
        cur.childForFieldName('parameters') ??
        // Arrow functions sometimes expose the lone parameter directly.
        (cur.type === 'arrow_function' ? cur.childForFieldName('parameter') : null)
      if (params && parameterListBinds(params, name)) return true
    }

    // Inspect any preceding sibling statements within the current block for
    // a local variable declaration that binds `name`. We only need to find
    // a single shadowing binding to suppress.
    if (
      cur.type === 'statement_block' ||
      cur.type === 'program' ||
      cur.type === 'class_body'
    ) {
      for (let i = 0; i < cur.namedChildCount; i++) {
        const stmt = cur.namedChild(i)
        if (!stmt) continue
        if (declarationBindsNonUseState(stmt, name)) return true
      }
    }

    cur = cur.parent
  }
  return false
}

/**
 * Recursively check a `formal_parameters` node (or single arrow param) for
 * any binding identifier of `name`. Handles required/optional parameters,
 * defaults, rest parameters, and object/array destructuring patterns.
 */
function parameterListBinds(node: SyntaxNode, name: string): boolean {
  if (node.type === 'identifier') return node.text === name
  if (node.type === 'shorthand_property_identifier_pattern') return node.text === name

  // For destructuring patterns, walk children but skip property keys (which
  // are not bindings themselves).
  if (node.type === 'pair_pattern') {
    const value = node.childForFieldName('value')
    return value ? parameterListBinds(value, name) : false
  }

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)
    if (child && parameterListBinds(child, name)) return true
  }
  return false
}

/**
 * Return true if `stmt` is a `let`/`const`/`var` declaration that binds
 * `name`, but is NOT the `const [name, setName] = useState(...)` destructuring.
 */
function declarationBindsNonUseState(stmt: SyntaxNode, name: string): boolean {
  if (stmt.type !== 'lexical_declaration' && stmt.type !== 'variable_declaration') {
    return false
  }

  for (let i = 0; i < stmt.namedChildCount; i++) {
    const declarator = stmt.namedChild(i)
    if (!declarator || declarator.type !== 'variable_declarator') continue

    const pattern = declarator.childForFieldName('name')
    const value = declarator.childForFieldName('value')
    if (!pattern) continue

    // Skip the useState destructuring: `const [name, setName] = useState(...)`.
    if (pattern.type === 'array_pattern' && isUseStateCall(value)) {
      continue
    }

    if (patternBinds(pattern, name)) return true
  }
  return false
}

function isUseStateCall(node: SyntaxNode | null): boolean {
  if (!node || node.type !== 'call_expression') return false
  const fn = node.childForFieldName('function')
  if (!fn) return false
  // Match `useState(...)` or `React.useState(...)`.
  if (fn.type === 'identifier' && fn.text === 'useState') return true
  if (fn.type === 'member_expression') {
    const prop = fn.childForFieldName('property')
    if (prop && prop.text === 'useState') return true
  }
  return false
}

function patternBinds(pattern: SyntaxNode, name: string): boolean {
  if (pattern.type === 'identifier') return pattern.text === name
  if (pattern.type === 'shorthand_property_identifier_pattern') return pattern.text === name

  if (pattern.type === 'pair_pattern') {
    const value = pattern.childForFieldName('value')
    return value ? patternBinds(value, name) : false
  }

  for (let i = 0; i < pattern.namedChildCount; i++) {
    const child = pattern.namedChild(i)
    if (child && patternBinds(child, name)) return true
  }
  return false
}

export const reactUselessSetStateVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/react-useless-set-state',
  languages: ['tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'identifier') return null

    // setX(x) — setter called with the same state variable name
    if (!/^set[A-Z]/.test(fn.text)) return null

    const stateVarName = fn.text.charAt(3).toLowerCase() + fn.text.slice(4)

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const argList = args.namedChildren
    if (argList.length !== 1) return null

    const arg = argList[0]
    if (!arg || arg.type !== 'identifier') return null

    if (arg.text !== stateVarName) return null

    // Suppress when the identifier resolves to a parameter or a local
    // declaration that shadows the state variable's name (not the useState
    // destructuring itself).
    if (isShadowedAtCall(node, stateVarName)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      `Useless setState: ${fn.text}(${stateVarName})`,
      `\`${fn.text}(${stateVarName})\` sets state to the current value — this is a no-op.`,
      sourceCode,
      `Remove the \`${fn.text}(${stateVarName})\` call or update it with a new value.`,
    )
  },
}
