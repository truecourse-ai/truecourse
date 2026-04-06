import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonStripWithMultiCharsVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/strip-with-multi-chars',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const attr = fn.childForFieldName('attribute')
    if (!attr || !['strip', 'lstrip', 'rstrip'].includes(attr.text)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const argNodes = args.namedChildren
    if (argNodes.length === 0) return null

    const firstArg = argNodes[0]
    if (!firstArg || firstArg.type !== 'string') return null

    // Strip the quotes and check if it's a multi-character string
    const rawStr = firstArg.text
    // Handle both 'abc' and "abc" and triple-quoted strings
    let content = rawStr
    if (content.startsWith('"""') || content.startsWith("'''")) {
      content = content.slice(3, -3)
    } else if (content.startsWith('"') || content.startsWith("'")) {
      content = content.slice(1, -1)
    }

    // Only flag if more than one character (and not an escape sequence for one char)
    if (content.length > 1 && !content.startsWith('\\')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'strip() with multi-character string',
        `\`${attr.text}("${content}")\` strips each individual character in "${content}", not the substring "${content}" — this is a common misunderstanding.`,
        sourceCode,
        `If you want to remove the prefix/suffix "${content}", use \`.removeprefix()\` / \`.removesuffix()\` (Python 3.9+) or check manually.`,
      )
    }
    return null
  },
}
