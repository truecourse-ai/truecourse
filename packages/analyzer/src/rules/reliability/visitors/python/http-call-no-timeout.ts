import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const PYTHON_HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'request'])

export const pythonHttpCallNoTimeoutVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/http-call-no-timeout',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const obj = fn.childForFieldName('object')
    const attr = fn.childForFieldName('attribute')
    if (!obj || !attr) return null

    // requests.get(), httpx.get(), etc.
    const objName = obj.text
    if (objName !== 'requests' && objName !== 'httpx' && objName !== 'session') return null
    if (!PYTHON_HTTP_METHODS.has(attr.text)) return null

    // `session` is heavily overloaded — SQLAlchemy AsyncSession /
    // sessionmaker bind to the same identifier and use the same
    // `.delete()` / `.commit()` / `.get()` method names. Only treat
    // `session.X()` as HTTP when the file actually imports `requests`
    // or `httpx`. Without this gate, every OpenHands `enterprise/
    // storage/*.py` file produced FPs on `await session.delete(record)`
    // SQLAlchemy ORM deletions.
    if (objName === 'session') {
      if (!/\b(?:import\s+requests|from\s+requests\b|import\s+httpx|from\s+httpx\b)/.test(sourceCode)) {
        return null
      }
    }

    // Check for timeout keyword argument
    const args = node.childForFieldName('arguments')
    if (args) {
      for (const arg of args.namedChildren) {
        if (arg.type === 'keyword_argument') {
          const name = arg.childForFieldName('name')
          if (name?.text === 'timeout') return null
        }
      }
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'HTTP call without timeout',
      `${objName}.${attr.text}() called without a timeout parameter. Requests may hang indefinitely.`,
      sourceCode,
      `Add timeout=<seconds> to the ${objName}.${attr.text}() call.`,
    )
  },
}
