import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/** Built-in functions that execute arbitrary code. */
const PYTHON_EVAL_BUILTINS = new Set(['eval', 'exec', 'compile'])

/**
 * Safe receivers whose .eval() / .compile() methods do NOT execute arbitrary
 * Python code (e.g. re.compile(), redis.eval() runs Lua, model.eval() in PyTorch).
 */
const SAFE_METHOD_RECEIVERS = new Set([
  're', 'regex', 'redis', 'model', 'torch', 'tf', 'np', 'pd', 'ast',
])

export const pythonEvalUsageVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/eval-usage',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let funcName = ''
    if (fn.type === 'identifier') {
      // Bare call: eval(...), exec(...), compile(...)
      funcName = fn.text
    } else if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      if (attr) funcName = attr.text

      // For method calls (receiver.eval(), receiver.compile()), check if the
      // receiver is a known safe module/object — skip if so.
      const receiver = fn.childForFieldName('object')
      if (receiver) {
        const receiverName = receiver.type === 'identifier' ? receiver.text : null
        if (receiverName && SAFE_METHOD_RECEIVERS.has(receiverName)) return null
      }
    }

    if (PYTHON_EVAL_BUILTINS.has(funcName)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Dynamic code evaluation',
        `${funcName}() allows arbitrary code execution and is a security risk.`,
        sourceCode,
        `Avoid ${funcName}(). Use safer alternatives like ast.literal_eval() or JSON parsing.`,
      )
    }

    return null
  },
}
