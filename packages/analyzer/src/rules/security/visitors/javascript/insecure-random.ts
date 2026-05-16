import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/** Security-related variable name keywords that indicate cryptographic use */
const SECURITY_KEYWORDS = ['token', 'secret', 'key', 'nonce', 'salt', 'csrf', 'password', 'session', 'hash', 'iv']

function hasSecurityKeyword(name: string | undefined | null): boolean {
  if (!name) return false
  const lower = name.toLowerCase()
  return SECURITY_KEYWORDS.some((kw) => lower.includes(kw))
}

function makeViolationHere(ruleKey: string, node: SyntaxNode, filePath: string, sourceCode: string) {
  return makeViolation(
    ruleKey,
    node,
    filePath,
    'high',
    'Insecure random number generator',
    'Math.random() is not cryptographically secure. Do not use it for tokens, keys, or secrets.',
    sourceCode,
    'Use crypto.randomBytes() or crypto.randomUUID() instead.',
  )
}

/**
 * Return the name of the immediately enclosing function/method, if any.
 * Handles: function_declaration, function_expression, arrow_function (via variable_declarator
 * or pair value), method_definition.
 */
function enclosingFunctionName(node: SyntaxNode): string | null {
  let cur: SyntaxNode | null = node.parent
  while (cur) {
    if (cur.type === 'function_declaration' || cur.type === 'generator_function_declaration') {
      const nameNode = cur.childForFieldName('name')
      return nameNode?.text ?? null
    }
    if (cur.type === 'method_definition') {
      const nameNode = cur.childForFieldName('name')
      return nameNode?.text ?? null
    }
    if (
      cur.type === 'arrow_function' ||
      cur.type === 'function_expression' ||
      cur.type === 'function' ||
      cur.type === 'generator_function'
    ) {
      // Look at parent for the binding name (variable_declarator / pair / assignment_expression).
      const p = cur.parent
      if (p?.type === 'variable_declarator') {
        const n = p.childForFieldName('name')
        return n?.text ?? null
      }
      if (p?.type === 'pair') {
        const k = p.childForFieldName('key')
        return k?.text ?? null
      }
      if (p?.type === 'assignment_expression') {
        const left = p.childForFieldName('left')
        return left?.text ?? null
      }
      return null
    }
    cur = cur.parent
  }
  return null
}

type TargetKind = 'pair' | 'variable' | 'assignment'
interface AssignmentTarget {
  kind: TargetKind
  name: string
}

/**
 * Return the immediate assignment target when Math.random()'s call expression
 * is the direct value of: `pair (key: value)`, `variable_declarator (name = value)`,
 * or `assignment_expression (left = right)`. Walks through wrapping member/call/binary
 * expressions like `Math.random().toString(36)` since the value field is the outermost
 * chained expression, not the bare call.
 */
function immediateAssignmentTarget(callNode: SyntaxNode): AssignmentTarget | null {
  // Walk up through chained call/member expressions: Math.random().toString(36).slice(2,7)
  let cur: SyntaxNode = callNode
  while (cur.parent) {
    const p: SyntaxNode = cur.parent
    if (
      p.type === 'member_expression' ||
      p.type === 'call_expression' ||
      p.type === 'subscript_expression'
    ) {
      // Only continue up if current node is the object/function being chained from.
      const obj = p.childForFieldName('object') ?? p.childForFieldName('function')
      if (obj && obj.id === cur.id) {
        cur = p
        continue
      }
      return null
    }
    if (p.type === 'pair') {
      const valueNode = p.childForFieldName('value')
      if (valueNode && valueNode.id === cur.id) {
        const k = p.childForFieldName('key')
        return k?.text ? { kind: 'pair', name: k.text } : null
      }
      return null
    }
    if (p.type === 'variable_declarator') {
      const valueNode = p.childForFieldName('value')
      if (valueNode && valueNode.id === cur.id) {
        const n = p.childForFieldName('name')
        return n?.text ? { kind: 'variable', name: n.text } : null
      }
      return null
    }
    if (p.type === 'assignment_expression') {
      const right = p.childForFieldName('right')
      if (right && right.id === cur.id) {
        const left = p.childForFieldName('left')
        return left?.text ? { kind: 'assignment', name: left.text } : null
      }
      return null
    }
    // Stop at expression boundaries we don't traverse through.
    if (
      p.type === 'parenthesized_expression' ||
      p.type === 'template_string' ||
      p.type === 'template_substitution' ||
      p.type === 'binary_expression' ||
      p.type === 'unary_expression' ||
      p.type === 'ternary_expression'
    ) {
      cur = p
      continue
    }
    return null
  }
  return null
}

export const insecureRandomVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/insecure-random',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const obj = fn.childForFieldName('object')
    const prop = fn.childForFieldName('property')
    if (obj?.text !== 'Math' || prop?.text !== 'random') return null

    // Skip random array index selection: anything inside `<expr> * arr.length` or
    // `Math.floor(... * arr.length)` is a non-security pattern.
    let p: SyntaxNode | null = node.parent
    while (p && (p.type === 'binary_expression' || p.type === 'parenthesized_expression' || p.type === 'call_expression')) {
      if (p.type === 'binary_expression' && /\.length\b/.test(p.text)) return null
      p = p.parent
    }

    // Flag only when the closest naming signal indicates cryptographic intent:
    //   (a) the enclosing function/method's own name has a security keyword
    //       (e.g. generateToken, createSessionKey), OR
    //   (b) the immediate variable/lvalue target has a security keyword
    //       (e.g. const token = ..., this.secret = ...).
    //
    // Object-property assignments (`{ token: Math.random()... }`) intentionally
    // do NOT fire on their own: they are common in seed/test/fixture builders
    // and adjacent transaction payloads where Math.random() is incidental. Such
    // cases must still be flagged when the enclosing function name signals
    // cryptographic intent.
    const fnName = enclosingFunctionName(node)
    const target = immediateAssignmentTarget(node)

    if (hasSecurityKeyword(fnName)) {
      return makeViolationHere(this.ruleKey, node, filePath, sourceCode)
    }

    if (target && target.kind !== 'pair' && hasSecurityKeyword(target.name)) {
      return makeViolationHere(this.ruleKey, node, filePath, sourceCode)
    }

    return null
  },
}
