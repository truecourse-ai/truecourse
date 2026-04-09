import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const httpCallNoTimeoutVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/http-call-no-timeout',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let funcName = ''
    let objectName = ''
    if (fn.type === 'identifier') {
      funcName = fn.text
    } else if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      const obj = fn.childForFieldName('object')
      if (prop) funcName = prop.text
      if (obj) objectName = obj.text
    }

    const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'request', 'head'])

    // fetch() call
    if (funcName === 'fetch') {
      // Skip client-side React components fetching own API — browser fetch has default timeouts
      if (/\.tsx$/.test(filePath) && /\/components\//.test(filePath)) return null
      const args = node.childForFieldName('arguments')
      if (args) {
        const optionsArg = args.namedChildren[1]
        if (optionsArg && optionsArg.text.includes('signal')) return null
        // Skip fetch to relative URLs (same-origin internal API calls)
        // Only flag external HTTP calls that could hang indefinitely
        const urlArg = args.namedChildren[0]
        if (urlArg) {
          const urlText = urlArg.text
          // Relative URLs start with '/' or backtick template starting with /
          if (urlText.startsWith("'/") || urlText.startsWith('"/') || urlText.startsWith('`/')) return null
        }
      }
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'HTTP call without timeout',
        'fetch() called without an AbortSignal timeout. Requests may hang indefinitely.',
        sourceCode,
        'Pass { signal: AbortSignal.timeout(ms) } as the second argument to fetch().',
      )
    }

    // axios / axios.get/post/etc.
    if (funcName === 'axios' || (objectName === 'axios' && HTTP_METHODS.has(funcName))) {
      const args = node.childForFieldName('arguments')
      if (args) {
        for (const arg of args.namedChildren) {
          if (arg.type === 'object' && arg.text.includes('timeout')) return null
        }
      }
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'HTTP call without timeout',
        `${objectName ? objectName + '.' : ''}${funcName}() called without a timeout option.`,
        sourceCode,
        'Add a timeout option (e.g., { timeout: 10000 }) to the request configuration.',
      )
    }

    return null
  },
}
