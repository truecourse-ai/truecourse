import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonGetattrWithConstantVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/getattr-with-constant',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'identifier') return null
    if (fn.text !== 'getattr' && fn.text !== 'setattr' && fn.text !== 'delattr') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null
    const positional = args.namedChildren.filter((a) => a.type !== 'keyword_argument')

    // getattr(obj, "constant_attr") or setattr(obj, "constant_attr", val) or delattr(obj, "constant_attr")
    const attrArg = positional[1]
    if (!attrArg) return null
    if (attrArg.type !== 'string') return null

    // `getattr(obj, "name", default)` (3 positional args) is the safe-access
    // pattern — `obj.name` would raise AttributeError when the attribute is
    // missing. The default-value form has DIFFERENT semantics from direct
    // attribute access; flagging it as "could be written as obj.name" is
    // wrong. setattr/delattr take 3rd arg as the value to set, not a
    // default, so they remain flagged.
    if (fn.text === 'getattr' && positional.length >= 3) return null

    // Check it's a simple identifier-like string
    const inner = attrArg.text.slice(1, -1)
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(inner)) return null

    // Skip setattr/getattr on stdlib `logging.LogRecord` objects.
    // Logging filters / formatters discover fields via
    // `record.__dict__` and `getattr(record, name)`; the setattr
    // form is conventional and lets later code parameterize the
    // field name without code change.
    const targetName = positional[0]?.text ?? ''
    const LOG_RECORD_TARGETS = new Set([
      'record', 'new_record', 'log_record', 'rec', 'new_rec',
    ])
    if (LOG_RECORD_TARGETS.has(targetName)) return null

    const fnName = fn.text
    const objText = positional[0]?.text || 'obj'

    const suggestion = fnName === 'getattr'
      ? `\`${objText}.${inner}\``
      : fnName === 'setattr'
        ? `\`${objText}.${inner} = ...\``
        : `\`del ${objText}.${inner}\``

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      `${fnName}() with constant string`,
      `\`${fnName}(${objText}, "${inner}")\` can be written as ${suggestion} for clarity.`,
      sourceCode,
      `Replace with direct attribute access: ${suggestion}.`,
    )
  },
}
