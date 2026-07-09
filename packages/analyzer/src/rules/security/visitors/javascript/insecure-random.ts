import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/** Security-related variable name keywords that indicate cryptographic use */
const SECURITY_KEYWORDS = ['token', 'secret', 'key', 'nonce', 'salt', 'csrf', 'password', 'session', 'hash', 'iv']

function isSecuritySensitiveName(name: string): boolean {
  const lower = name.toLowerCase()
  return SECURITY_KEYWORDS.some((kw) => lower.includes(kw))
}

/**
 * Walk up from the Math.random() call to the name the random value flows
 * into — the variable it is declared as, the target of an assignment, or
 * the object-property key it is set under. Returns that leaf name, or null
 * if the value is not bound to a name before a structural boundary
 * (function body, loop, conditional) is reached.
 *
 * This deliberately inspects only *binding targets*, never the full text of
 * ancestor nodes. Scanning ancestor text produced false positives whenever
 * an unrelated binding in scope happened to contain a keyword substring —
 * e.g. a `for (const { key } of entries)` loop over map-entry keys, where
 * `key` is a data field, not a cryptographic key.
 */
function securityContextName(callNode: SyntaxNode): string | null {
  let parent = callNode.parent
  while (parent) {
    switch (parent.type) {
      case 'variable_declarator':
        return leafName(parent.childForFieldName('name'))
      case 'assignment_expression':
      case 'augmented_assignment_expression':
        return leafName(parent.childForFieldName('left'))
      case 'pair':
        return leafName(parent.childForFieldName('key'))
      case 'public_field_definition':
      case 'field_definition':
        return leafName(parent.childForFieldName('property') ?? parent.childForFieldName('name'))
      // The value is returned from the enclosing function (e.g.
      // `function generateToken() { return Math.random()... }`) — the
      // function name is the security context.
      case 'return_statement':
        return enclosingFunctionName(parent)
      // Expression-bodied arrow returns the value directly, e.g.
      // `const genToken = () => Math.random()...`.
      case 'arrow_function':
        return functionName(parent)
      // Structural boundaries: the random value is discarded or otherwise
      // not bound to a name.
      case 'expression_statement':
      case 'statement_block':
      case 'if_statement':
      case 'for_statement':
      case 'for_in_statement':
      case 'while_statement':
      case 'do_statement':
      case 'switch_statement':
      case 'function_declaration':
      case 'function_expression':
      case 'method_definition':
        return null
    }
    parent = parent.parent
  }
  return null
}

/** The name of the function enclosing `node`, resolving anonymous functions to their binding. */
function enclosingFunctionName(node: SyntaxNode): string | null {
  let p = node.parent
  while (p) {
    if (
      p.type === 'function_declaration' ||
      p.type === 'generator_function_declaration' ||
      p.type === 'method_definition' ||
      p.type === 'arrow_function' ||
      p.type === 'function_expression'
    ) {
      return functionName(p)
    }
    p = p.parent
  }
  return null
}

/** The declared name of a function, or the binding an anonymous function is assigned to. */
function functionName(fn: SyntaxNode): string | null {
  const nameField = fn.childForFieldName('name')
  if (nameField) return leafName(nameField)
  const p = fn.parent
  if (!p) return null
  if (p.type === 'variable_declarator') return leafName(p.childForFieldName('name'))
  if (p.type === 'pair') return leafName(p.childForFieldName('key'))
  if (p.type === 'assignment_expression') return leafName(p.childForFieldName('left'))
  if (p.type === 'public_field_definition' || p.type === 'field_definition') {
    return leafName(p.childForFieldName('property') ?? p.childForFieldName('name'))
  }
  return null
}

/** Reduce a target node to the identifier that names it (final property for member access). */
function leafName(node: SyntaxNode | null): string | null {
  if (!node) return null
  if (node.type === 'identifier' || node.type === 'property_identifier' || node.type === 'shorthand_property_identifier') {
    return node.text
  }
  if (node.type === 'member_expression') {
    return node.childForFieldName('property')?.text ?? null
  }
  if (node.type === 'string') {
    return node.text.slice(1, -1)
  }
  return node.text
}

/**
 * Seed scripts and test files generate fixture/dev data — the "tokens"
 * produced here never reach production, so Math.random() is appropriate
 * and flagging it is a false positive.
 */
function isFixtureOrTestFile(filePath: string): boolean {
  const lower = filePath.toLowerCase()
  return (
    /[\\/]seeds?[\\/]/.test(lower) ||
    /[\\/](?:seed|seeds)\.(?:ts|tsx|js|jsx|mts|cts|mjs|cjs)$/.test(lower) ||
    /\.seed\.(?:ts|tsx|js|jsx|mts|cts|mjs|cjs)$/.test(lower) ||
    /[\\/]__tests__[\\/]/.test(lower) ||
    /\.(?:test|spec)\.(?:ts|tsx|js|jsx|mts|cts|mjs|cjs)$/.test(lower)
  )
}

export const insecureRandomVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/insecure-random',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    if (isFixtureOrTestFile(filePath)) return null
    const fn = node.childForFieldName('function')
    if (!fn) return null

    if (fn.type === 'member_expression') {
      const obj = fn.childForFieldName('object')
      const prop = fn.childForFieldName('property')
      if (obj?.text === 'Math' && prop?.text === 'random') {
        // Skip random array index selection pattern: Math.floor(Math.random() * arr.length)
        // This is a common non-security pattern for shuffling or picking random elements.
        const parentNode = node.parent
        if (parentNode?.type === 'binary_expression') {
          const parentText = parentNode.text
          if (/\.length\b/.test(parentText)) return null
        }

        // Only flag when the random value is bound to a security-sensitive
        // name — the variable it is declared as, the target of an assignment,
        // or the object-property key it is stored under. Checking the binding
        // *target* (rather than scanning the full text of every ancestor)
        // avoids false positives from unrelated bindings in scope that merely
        // contain a keyword substring, such as a `for (const { key } of ...)`
        // loop over map-entry keys where `key` is a data field, not a secret.
        const contextName = securityContextName(node)
        if (contextName && isSecuritySensitiveName(contextName)) {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'Insecure random number generator',
            'Math.random() is not cryptographically secure. Do not use it for tokens, keys, or secrets.',
            sourceCode,
            'Use crypto.randomBytes() or crypto.randomUUID() instead.',
          )
        }
      }
    }

    return null
  },
}
