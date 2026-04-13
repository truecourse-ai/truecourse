import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getPythonImportSources } from '../../../_shared/python-framework-detection.js'

/** Built-in functions that execute arbitrary code. */
const PYTHON_EVAL_BUILTINS = new Set(['eval', 'exec', 'compile'])

/**
 * Safe receivers whose .eval() / .compile() methods do NOT execute arbitrary
 * Python code (e.g. re.compile(), redis.eval() runs Lua, model.eval() in PyTorch).
 */
const SAFE_METHOD_RECEIVERS = new Set([
  're', 'regex', 'redis', 'model', 'torch', 'tf', 'np', 'pd', 'ast',
])

/**
 * Mapping from receiver names to their expected import module sources.
 * Used to verify that a receiver is actually the safe module, not a local variable
 * that happens to share the name.
 */
const SAFE_RECEIVER_IMPORT_SOURCES: Record<string, string[]> = {
  're': ['re'],
  'regex': ['regex'],
  'redis': ['redis', 'redis.client', 'aioredis'],
  'torch': ['torch', 'torch.nn'],
  'tf': ['tensorflow', 'tensorflow.keras'],
  'np': ['numpy'],
  'pd': ['pandas'],
  'ast': ['ast'],
}

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
        if (leafName && SAFE_METHOD_RECEIVERS.has(leafName)) {
          // Fast path: name matches a known safe receiver.
          // Verify via import sources when a mapping is available.
          const expectedSources = SAFE_RECEIVER_IMPORT_SOURCES[leafName]
          if (expectedSources) {
            const sources = getPythonImportSources(node)
            // If imports confirm the safe module, skip
            for (const src of sources) {
              if (expectedSources.some(es => src === es || src.startsWith(es + '.'))) {
                return null
              }
            }
            // If there are no imports at all (snippet), trust the name
            if (sources.size === 0) return null
          }
          // For receivers without import mapping (model, etc.), trust the name
          if (!expectedSources) return null
        }
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
