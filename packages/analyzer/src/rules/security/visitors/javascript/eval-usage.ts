import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const EVAL_FUNCTIONS = new Set(['eval'])
const TIMER_FUNCTIONS = new Set(['setTimeout', 'setInterval'])
// Objects whose `.eval` member genuinely is the global eval function.
const GLOBAL_OBJECTS = new Set(['window', 'globalThis', 'global', 'self'])

export const evalUsageVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/eval-usage',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression', 'new_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function') ?? node.childForFieldName('constructor')
    if (!fn) return null

    let funcName = ''
    let isMemberCall = false
    let objectText = ''
    if (fn.type === 'identifier') {
      funcName = fn.text
    } else if (fn.type === 'member_expression') {
      isMemberCall = true
      const prop = fn.childForFieldName('property')
      if (prop) funcName = prop.text
      const obj = fn.childForFieldName('object')
      if (obj) objectText = obj.text
    }

    // eval() — only the global eval function. A bare `eval(...)` identifier
    // call, or an explicit global access like `globalThis.eval(...)`. A
    // member call such as `client.eval(...)` is that object's own method
    // (e.g. a key/value store's server-side scripting primitive), not the
    // global eval the rule targets.
    if (EVAL_FUNCTIONS.has(funcName) && (!isMemberCall || GLOBAL_OBJECTS.has(objectText))) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Dynamic code evaluation',
        `${funcName}() allows arbitrary code execution and is a security risk.`,
        sourceCode,
        'Avoid eval/exec. Use safer alternatives like JSON.parse() or a sandboxed interpreter.',
      )
    }

    // new Function(...)
    if (node.type === 'new_expression' && funcName === 'Function') {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Dynamic code evaluation',
        'new Function() is equivalent to eval() and allows arbitrary code execution.',
        sourceCode,
        'Avoid the Function constructor. Use safer alternatives.',
      )
    }

    // setTimeout/setInterval with string argument
    if (TIMER_FUNCTIONS.has(funcName)) {
      const args = node.childForFieldName('arguments')
      if (args) {
        const firstArg = args.namedChildren[0]
        if (firstArg && (firstArg.type === 'string' || firstArg.type === 'template_string')) {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'Dynamic code evaluation',
            `${funcName}() with a string argument is equivalent to eval().`,
            sourceCode,
            'Pass a function reference instead of a string to setTimeout/setInterval.',
          )
        }
      }
    }

    return null
  },
}
