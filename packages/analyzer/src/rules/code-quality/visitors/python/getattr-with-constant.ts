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

    // Check it's a simple identifier-like string
    const inner = attrArg.text.slice(1, -1)
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(inner)) return null

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
