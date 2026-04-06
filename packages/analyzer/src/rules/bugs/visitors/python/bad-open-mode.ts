import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { VALID_OPEN_MODES } from './_helpers.js'

export const pythonBadOpenModeVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/bad-open-mode',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.text !== 'open') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const argChildren = args.namedChildren
    if (argChildren.length < 2) return null

    // Second positional arg is the mode
    const modeArg = argChildren[1]
    if (!modeArg || modeArg.type !== 'string') return null

    // Strip quotes
    const raw = modeArg.text
    const mode = raw.slice(1, -1)

    if (!VALID_OPEN_MODES.has(mode)) {
      return makeViolation(
        this.ruleKey, modeArg, filePath, 'high',
        'Invalid file open mode',
        `\`open(..., "${mode}")\` uses an invalid mode string — this will raise a ValueError at runtime.`,
        sourceCode,
        `Use a valid mode string such as "r", "w", "a", "rb", "w+", etc.`,
      )
    }

    return null
  },
}
