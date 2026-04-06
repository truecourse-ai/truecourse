import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects dict.get(key, 0) or dict.get(key, "") where the falsy default
 * could mask existing falsy values. Consider checking None explicitly instead.
 */
export const pythonFalsyDictGetFallbackVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/falsy-dict-get-fallback',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const func = node.childForFieldName('function')
    if (!func || func.type !== 'attribute') return null

    const attr = func.childForFieldName('attribute')
    if (!attr || attr.text !== 'get') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const positionalArgs = args.namedChildren.filter((a) => a.type !== 'keyword_argument')
    if (positionalArgs.length < 2) return null

    const defaultArg = positionalArgs[1]

    // Check if the default is a falsy value: 0, "", '', [], {}, False, ()
    const falsyDefaults = new Set(['0', '""', "''", '[]', '{}', 'False', '()', 'b""', "b''"])
    const defaultText = defaultArg.text

    if (!falsyDefaults.has(defaultText)) return null

    const dictObj = func.childForFieldName('object')
    const keyArg = positionalArgs[0]

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Falsy dict.get fallback',
      `\`${dictObj?.text}.get(${keyArg?.text}, ${defaultText})\` uses a falsy default — if the dictionary contains a falsy value for this key, you can't distinguish it from a missing key. Consider checking for \`None\` explicitly.`,
      sourceCode,
      `Use \`${dictObj?.text}.get(${keyArg?.text})\` and check \`if value is None:\` to distinguish missing keys from falsy values.`,
    )
  },
}
