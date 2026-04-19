import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('web-tree-sitter').Node

function extendsBaseException(node: SyntaxNode): boolean {
  const bases = node.childForFieldName('superclasses')
  if (!bases) return false
  for (const base of bases.namedChildren) {
    if (base.type === 'identifier' && base.text === 'BaseException') return true
  }
  return false
}

function isExceptionClass(node: SyntaxNode): boolean {
  const name = node.childForFieldName('name')?.text ?? ''
  // Heuristic: class name ends with Error or Exception
  if (/Error$|Exception$/.test(name)) return true

  // Or it extends Exception (directly or via BaseException)
  const bases = node.childForFieldName('superclasses')
  if (!bases) return false
  return bases.namedChildren.some((b) => {
    const text = b.text
    return text === 'Exception' || text === 'BaseException' || /Error$|Exception$/.test(text)
  })
}

export const pythonExceptionBaseClassVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/exception-base-class',
  languages: ['python'],
  nodeTypes: ['class_definition'],
  visit(node, filePath, sourceCode) {
    if (!isExceptionClass(node)) return null
    if (!extendsBaseException(node)) return null

    const name = node.childForFieldName('name')?.text ?? 'CustomException'

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Custom exception inherits from BaseException',
      `\`${name}\` inherits from \`BaseException\` directly. Custom exceptions should inherit from \`Exception\` or a more specific subclass — \`BaseException\` also catches system-level exceptions like \`KeyboardInterrupt\` and \`SystemExit\`.`,
      sourceCode,
      `Change the base class from \`BaseException\` to \`Exception\` or a more specific exception class.`,
    )
  },
}
