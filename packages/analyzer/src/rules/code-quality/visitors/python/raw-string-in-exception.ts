import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonRawStringInExceptionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/raw-string-in-exception',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    // Check if this is an exception constructor (ends with Error or Exception, or common exceptions)
    const fnText = fn.text
    const isException = /Error$|Exception$/.test(fnText) ||
      ['ValueError', 'TypeError', 'RuntimeError', 'OSError', 'IOError', 'KeyError',
       'IndexError', 'AttributeError', 'ImportError', 'NotImplementedError'].includes(fnText)
    if (!isException) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null
    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    // Check if inside raise statement
    const parent = node.parent
    if (parent?.type !== 'raise_statement') return null

    if (firstArg.type === 'string') {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'String literal in exception constructor',
        'Passing a raw string literal to an exception constructor duplicates the message in the traceback.',
        sourceCode,
        'Assign the message to a variable first, then pass the variable: `msg = "..."; raise Error(msg)`.',
      )
    }
    if (firstArg.type === 'formatted_string' || firstArg.text.startsWith('f"') || firstArg.text.startsWith("f'")) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'f-string in exception constructor',
        'Passing an f-string directly to an exception constructor duplicates the message in the traceback.',
        sourceCode,
        'Assign the f-string to a variable first, then pass the variable.',
      )
    }
    return null
  },
}
