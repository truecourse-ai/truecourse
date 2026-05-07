import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'
import { MAGIC_NUMBER_WHITELIST } from './_helpers.js'

// Time conversion factors: only skip when 2+ appear together in a multiplication chain
const TIME_FACTORS = new Set([24, 60, 3600, 86400])

// Standard HTTP status codes. When compared against `.status`,
// `statusCode`, or passed as the second argument to a `.json()` /
// `.send()` / `.redirect()` / `.status()` call (Express / Hono / Koa /
// Fastify response patterns), these are universally-known constants
// — extracting them to named constants would just be `const HTTP_OK =
// 200`. Documenso's audit found that flagging `err.status === 429`
// branches and `c.json({ error: '...' }, 500)` calls was high-noise
// across ~150+ hits.
const HTTP_STATUS_CODES = new Set([
  200, 201, 202, 204,
  301, 302, 303, 304, 307, 308,
  400, 401, 402, 403, 404, 405, 406, 408, 409, 410, 413, 415, 422, 429,
  500, 501, 502, 503, 504,
])

// Property names whose `=== <number>` comparison is conventionally a
// status check.
const STATUS_PROPERTY_NAMES = new Set(['status', 'statusCode', 'statuscode', 'code', 'httpStatus'])

// Method names whose second / status-position argument is the HTTP
// status code (Express `res.status(N)`, Hono `c.json(body, N)`, Koa
// `ctx.status = N`, Fastify `reply.code(N)`, etc.).
const STATUS_METHOD_NAMES = new Set([
  'status', 'statusCode', 'json', 'send', 'redirect', 'code', 'sendStatus',
])

/** Check if a tree-sitter node (or its descendants) contains a numeric time factor */
function hasTimeFactorInChain(node: SyntaxNode): boolean {
  if (node.type === 'number') {
    const val = parseFloat(node.text)
    return TIME_FACTORS.has(val)
  }
  if (node.type === 'binary_expression') {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child && hasTimeFactorInChain(child)) return true
    }
  }
  return false
}

export const magicNumberVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/magic-number',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['number'],
  visit(node, filePath, sourceCode) {
    const val = parseFloat(node.text)
    if (Number.isNaN(val)) return null
    if (MAGIC_NUMBER_WHITELIST.has(val)) return null

    // Only flag integers and simple decimals > 2
    if (!Number.isFinite(val)) return null

    const parent = node.parent
    if (!parent) return null

    // Skip: enum values, type annotations, array indices, object property values with meaningful context
    // Flag when used as: argument to function call, binary expression operand (not array index)
    const parentType = parent.type

    // Skip declarations of constants (e.g., const MAX = 100)
    if (parentType === 'variable_declarator') return null
    // Skip enum member
    if (parentType === 'enum_assignment') return null
    // Skip default parameter value
    if (parentType === 'assignment_pattern' || parentType === 'assignment_expression') return null
    // Skip return statements and object property values — too noisy in practice.
    if (parentType === 'return_statement') return null
    if (parentType === 'pair') return null
    // Only flag in binary expressions and function arguments
    if (parentType !== 'binary_expression' && parentType !== 'arguments') return null

    // Skip parseInt radix argument — parseInt(value, 10) is a standard JS idiom
    if (parentType === 'arguments') {
      const callExpr = parent.parent
      if (callExpr?.type === 'call_expression') {
        const fn = callExpr.childForFieldName('function')
        if (fn?.text === 'parseInt' || fn?.text === 'Number.parseInt') {
          // Only skip if this is the second argument (radix)
          const args = parent.namedChildren
          if (args.length >= 2 && args[1]?.id === node.id) return null
        }
        // HTTP-status argument to a response method:
        //   res.status(404), c.json(body, 500), reply.code(401)
        // The status code isn't a "magic number" — it's a universally
        // known protocol constant. Skip when the value is in the
        // standard HTTP set AND the call's method is a response helper.
        if (HTTP_STATUS_CODES.has(val)) {
          const fnNode = callExpr.childForFieldName('function')
          let methodName = ''
          if (fnNode?.type === 'member_expression') {
            methodName = fnNode.childForFieldName('property')?.text ?? ''
          } else if (fnNode?.type === 'identifier') {
            methodName = fnNode.text
          }
          if (STATUS_METHOD_NAMES.has(methodName)) return null
        }
      }
    }

    // Skip HTTP status codes in equality checks against a `.status` /
    // `.statusCode` / `.code` member: `err.status === 429`,
    // `response.statusCode !== 200`, etc.
    if (parentType === 'binary_expression' && HTTP_STATUS_CODES.has(val)) {
      const op = parent.children.find((c) =>
        c.text === '===' || c.text === '!==' || c.text === '==' || c.text === '!=',
      )
      if (op) {
        const left = parent.childForFieldName('left')
        const right = parent.childForFieldName('right')
        const sibling = left?.id === node.id ? right : left
        if (sibling?.type === 'member_expression') {
          const sibProp = sibling.childForFieldName('property')?.text ?? ''
          if (STATUS_PROPERTY_NAMES.has(sibProp)) return null
        }
      }
    }

    // Skip time conversion factors when they appear in a multiplication chain
    // with at least one other time factor (e.g., 60 * 1000, 24 * 60 * 60)
    if (parentType === 'binary_expression' && TIME_FACTORS.has(val)) {
      const op = parent.children.find((c) => c.text === '*')
      if (op) {
        // Check if the sibling operand is also a time factor or contains one
        const left = parent.childForFieldName('left')
        const right = parent.childForFieldName('right')
        const sibling = left?.id === node.id ? right : left
        if (sibling && hasTimeFactorInChain(sibling)) return null
      }
    }

    // Walk ancestors — skip if inside a named constant (e.g., const TIMEOUT_MS = 60 * 1000)
    let ancestor: typeof parent | null = parent
    while (ancestor) {
      if (ancestor.type === 'variable_declarator') {
        const name = ancestor.childForFieldName('name')
        if (name) {
          const varName = name.text
          // Skip if the constant has an uppercase or SCREAMING_SNAKE name
          if (varName === varName.toUpperCase() || /^[A-Z][A-Z0-9_]*$/.test(varName)) return null
        }
        break
      }
      ancestor = ancestor.parent
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      `Magic number: ${node.text}`,
      `Numeric literal \`${node.text}\` has no explanation. Extract it to a named constant for clarity.`,
      sourceCode,
      `Extract \`${node.text}\` to a named constant: \`const THRESHOLD = ${node.text};\``,
    )
  },
}
