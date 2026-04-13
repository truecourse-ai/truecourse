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
      // Handles both simple `re.compile()` and chained `self._redis.eval()`.
      const receiver = fn.childForFieldName('object')
      if (receiver) {
        let leafName: string | null = null
        if (receiver.type === 'identifier') {
          leafName = receiver.text
        } else if (receiver.type === 'attribute') {
          // For chained access like `self._redis`, extract the final attribute name
          const attrChild = receiver.childForFieldName('attribute')
          if (attrChild) {
            // Strip leading underscores: `_redis` -> `redis`
            leafName = attrChild.text.replace(/^_+/, '')
          }
        }
        if (leafName && SAFE_METHOD_RECEIVERS.has(leafName)) return null
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
