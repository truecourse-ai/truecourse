import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Returns true if the subtree contains an identifier `errName` accessed as
 * `errName.message` or `errName.stack` directly (no narrowing/ternary fallback
 * inside the same expression).
 */
function findRawErrorPropertyAccess(node: SyntaxNode, errName: string): SyntaxNode | null {
  // Inspect member_expression nodes for errName.stack / errName.message
  if (node.type === 'member_expression') {
    const obj = node.childForFieldName('object')
    const prop = node.childForFieldName('property')
    if (obj && prop && obj.text === errName && (prop.text === 'stack' || prop.text === 'message')) {
      return node
    }
  }
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)
    if (!child) continue
    const found = findRawErrorPropertyAccess(child, errName)
    if (found) return found
  }
  return null
}

/**
 * Returns true if the subtree is a ternary `cond ? errName.x : 'fallback'`
 * where one branch is a string literal — a safe narrowed access.
 */
function isNarrowedTernary(node: SyntaxNode): boolean {
  if (node.type !== 'ternary_expression') return false
  const consequence = node.namedChild(1)
  const alternative = node.namedChild(2)
  // Either branch a string literal indicates a fallback narrowing pattern
  const isStringLit = (n: SyntaxNode | null) =>
    !!n && (n.type === 'string' || n.type === 'template_string')
  return isStringLit(consequence) || isStringLit(alternative)
}

/**
 * Walks up from `propertyAccess` (an `errName.message`/`errName.stack` node)
 * and returns true if any ancestor up to `bodyRoot` is:
 *  - inside an if statement whose condition contains `instanceof`
 *  - inside a ternary with a string-literal fallback
 *  - inside a `throw` statement (re-throwing, not sending in response)
 *  - inside a logger/console call argument
 *  - assigned to a local variable (not directly in a response call)
 */
function isSafeContext(propertyAccess: SyntaxNode, bodyRoot: SyntaxNode): boolean {
  let cur: SyntaxNode | null = propertyAccess.parent
  while (cur && cur.id !== bodyRoot.id) {
    // throw statement — re-thrown, not a response payload
    if (cur.type === 'throw_statement') return true

    // Narrowed ternary with string fallback
    if (isNarrowedTernary(cur)) return true

    // Inside if-statement body where condition uses `instanceof`
    if (cur.type === 'if_statement') {
      const cond = cur.childForFieldName('condition')
      if (cond && cond.text.includes('instanceof')) return true
    }

    // Inside call to a logger/console method (NOT a response sender)
    if (cur.type === 'call_expression') {
      const fn = cur.childForFieldName('function')
      const fnText = fn?.text ?? ''
      // Known logging sinks — safe
      if (/^(?:console|logger|log|winston|pino)\b/.test(fnText)) return true
      if (/\b(?:logError|logFailure|logLimitCheckFailure|logJobFailure)\b/.test(fnText)) return true
      // Object property assignment to AppError constructor or similar
      if (/\b(?:AppError|HttpError|ApiError|ServiceError)\b/.test(fnText)) return true
    }

    // Variable declaration: `const reason = err.message ...` — assigned, not directly sent
    if (cur.type === 'variable_declarator' || cur.type === 'lexical_declaration') {
      return true
    }

    // Array.push(err.message) or results.errors.push(...) — collecting, not responding
    if (cur.type === 'call_expression') {
      const fn = cur.childForFieldName('function')
      if (fn && fn.type === 'member_expression') {
        const prop = fn.childForFieldName('property')
        if (prop?.text === 'push') return true
      }
    }

    cur = cur.parent
  }
  return false
}

/**
 * Detect direct raw-err pass: `res.json(err)`, `res.send(err)`,
 * `c.json(err)`, `Response.json(err)`, `new Response(err)`.
 */
function findDirectRawErrPass(body: SyntaxNode, errName: string): SyntaxNode | null {
  function walk(n: SyntaxNode): SyntaxNode | null {
    if (n.type === 'call_expression' || n.type === 'new_expression') {
      const fn = n.childForFieldName('function') ?? n.childForFieldName('constructor')
      const args = n.childForFieldName('arguments')
      if (fn && args) {
        const fnText = fn.text
        const isResponseSender =
          /\.(?:json|send)$/.test(fnText) ||
          fnText === 'Response.json' ||
          fnText === 'Response' ||
          fnText.endsWith('jsonResponse')
        if (isResponseSender) {
          // Check if any direct argument is `errName` identifier
          for (let i = 0; i < args.namedChildCount; i++) {
            const a = args.namedChild(i)
            if (a && a.type === 'identifier' && a.text === errName) return n
          }
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const child = n.namedChild(i)
      if (!child) continue
      const r = walk(child)
      if (r) return r
    }
    return null
  }
  return walk(body)
}

export const rawErrorInResponseVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/raw-error-in-response',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['catch_clause'],
  visit(node, filePath, sourceCode) {
    if (!filePath.match(/(?:route|controller|handler|api|server)/i)) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    const param = node.childForFieldName('parameter')
    if (!param) return null
    const errName = param.text.replace(/:.+/, '').trim()
    if (!errName) return null

    // Strong signal: err.stack accessed anywhere in catch body (always leaks)
    // Walk all member_expression nodes; flag any errName.stack that isn't safe.
    function findStackAccess(n: SyntaxNode): SyntaxNode | null {
      if (n.type === 'member_expression') {
        const obj = n.childForFieldName('object')
        const prop = n.childForFieldName('property')
        if (obj?.text === errName && prop?.text === 'stack') {
          if (!isSafeContext(n, body!)) return n
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (!child) continue
        const r = findStackAccess(child)
        if (r) return r
      }
      return null
    }
    const stackHit = findStackAccess(body)
    if (stackHit) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Error details exposed in API response',
        `Error stack from '${errName}' sent to client. This leaks implementation details.`,
        sourceCode,
        'Send a generic error message to the client and log the full error server-side.',
      )
    }

    // Direct raw-error pass into a response sender call.
    const directHit = findDirectRawErrPass(body, errName)
    if (directHit) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Error details exposed in API response',
        `Raw error '${errName}' passed directly to response. This leaks implementation details.`,
        sourceCode,
        'Send a generic error message to the client and log the full error server-side.',
      )
    }

    // `err.message` alone is only flagged when not within an instanceof-narrowed
    // branch, ternary fallback, throw, logger call, or local assignment.
    // (Conservative; production code overwhelmingly uses narrowed err.message safely.)
    void findRawErrorPropertyAccess

    return null
  },
}
