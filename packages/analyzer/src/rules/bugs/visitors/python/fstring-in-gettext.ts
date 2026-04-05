import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detects: f-string, .format(), or %-style formatting inside gettext calls
// Translation strings must be static so tools can extract them
const GETTEXT_FUNCTIONS = new Set(['_', 'gettext', 'ngettext', 'pgettext', 'npgettext', 'ugettext', 'ungettext', 'lazy_gettext', 'lazy_ngettext'])

export const pythonFstringInGettextVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/fstring-in-gettext',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const func = node.childForFieldName('function')
    if (!func) return null

    const funcName = func.type === 'identifier' ? func.text : func.childForFieldName('attribute')?.text
    if (!funcName || !GETTEXT_FUNCTIONS.has(funcName)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    // Check if argument is an f-string
    if (firstArg.type === 'string') {
      const raw = firstArg.text
      // f-string prefix: f"..." or f'...' or F"..." etc.
      if (/^[fF]['"]/.test(raw) || /^[fF]"""/.test(raw) || /^[fF]'''/.test(raw)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'f-string in gettext call',
          `f-string passed to \`${funcName}()\` — the translation string must be a static string literal so translation tools can extract it.`,
          sourceCode,
          `Use \`${funcName}("static string") % (value,)\` or move the dynamic parts outside: \`${funcName}("template %s") % dynamic_value\`.`,
        )
      }
    }

    // Check if argument is string.format(...) call
    if (firstArg.type === 'call') {
      const callFunc = firstArg.childForFieldName('function')
      if (callFunc?.type === 'attribute') {
        const attr = callFunc.childForFieldName('attribute')
        if (attr?.text === 'format') {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            '.format() in gettext call',
            `\`.format()\` used inside \`${funcName}()\` — the translation string must be a static string literal.`,
            sourceCode,
            `Call \`${funcName}()\` with a static string first, then format: \`${funcName}("static %s") % value\`.`,
          )
        }
      }
    }

    // Check if argument is % formatting (binary_operator with %)
    if (firstArg.type === 'binary_operator') {
      const op = firstArg.childForFieldName('operator')
      if (op?.text === '%') {
        const left = firstArg.childForFieldName('left')
        if (left?.type === 'string') {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'Printf-style format in gettext call',
            `\`%\` formatting used inside \`${funcName}()\` — the translation string must be a static string literal.`,
            sourceCode,
            `Call \`${funcName}()\` with a static string first, then format outside: \`${funcName}("static %s") % value\`.`,
          )
        }
      }
    }

    return null
  },
}
