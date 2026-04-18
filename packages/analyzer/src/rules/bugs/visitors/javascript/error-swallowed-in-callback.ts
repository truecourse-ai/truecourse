import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

const ERROR_PARAM_NAMES = new Set(['err', 'error', 'e', 'ex', 'exception'])

/**
 * Detects callbacks that receive an error as first parameter but never use it.
 * Common pattern: fs.readFile(path, (err, data) => { ... use data but not err ... })
 */
export const errorSwallowedInCallbackVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/error-swallowed-in-callback',
  languages: JS_LANGUAGES,
  nodeTypes: ['arrow_function', 'function'],
  visit(node, filePath, sourceCode) {
    const params = node.childForFieldName('parameters')
    if (!params) return null

    const paramList = params.namedChildren
    if (paramList.length === 0) return null

    // Check if the first parameter looks like an error parameter
    const firstParam = paramList[0]
    let paramName: string | null = null

    if (firstParam.type === 'identifier' && ERROR_PARAM_NAMES.has(firstParam.text)) {
      paramName = firstParam.text
    } else if (firstParam.type === 'required_parameter' || firstParam.type === 'optional_parameter') {
      const nameNode = firstParam.childForFieldName('pattern')
      if (nameNode?.type === 'identifier' && ERROR_PARAM_NAMES.has(nameNode.text)) {
        paramName = nameNode.text
      }
    }

    if (!paramName) return null

    // Must have at least 2 params to be an error-first callback
    if (paramList.length < 2) return null

    // Check if this function is passed as a callback argument (not a standalone function)
    const parent = node.parent
    if (!parent) return null

    const isCallbackArg =
      parent.type === 'arguments' ||
      parent.type === 'call_expression'

    if (!isCallbackArg) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    // Check if the error parameter is ever referenced in the body
    const errorName = paramName
    let isUsed = false

    function scanForUsage(n: import('tree-sitter').SyntaxNode): void {
      if (n.type === 'identifier' && n.text === errorName) {
        // Make sure it's not the parameter definition itself
        if (n.parent?.type !== 'required_parameter' && n.parent?.id !== params?.id) {
          isUsed = true
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child && !isUsed) scanForUsage(child)
      }
    }

    scanForUsage(body)

    if (!isUsed) {
      return makeViolation(
        this.ruleKey, firstParam, filePath, 'high',
        'Error parameter ignored in callback',
        `Callback receives \`${errorName}\` as the error parameter but never checks or uses it — errors are silently swallowed.`,
        sourceCode,
        `Check \`${errorName}\` before proceeding: \`if (${errorName}) { /* handle error */ return; }\``,
      )
    }

    return null
  },
}
