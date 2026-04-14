import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { SyntaxNode } from 'tree-sitter'

function isOpenReadClose(node: SyntaxNode): boolean {
  // Pattern: f = open(...); content = f.read(); f.close()
  // Too complex to detect reliably — focus on the simple with-open().read() pattern
  // or open().read() chain
  const fn = node.childForFieldName('function')
  if (!fn || fn.type !== 'attribute') return false
  const attr = fn.childForFieldName('attribute')
  if (!attr || (attr.text !== 'read' && attr.text !== 'read_text')) return false
  const obj = fn.childForFieldName('object')
  if (!obj) return false
  // open("file").read() pattern
  if (obj.type === 'call') {
    const openFn = obj.childForFieldName('function')
    if (openFn?.text === 'open') return true
  }
  return false
}

export const pythonReadWriteWholeFileVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/read-write-whole-file',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    if (isOpenReadClose(node)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Verbose file read',
        '`open(...).read()` can be replaced with `Path(...).read_text()` (Python 3.4+).',
        sourceCode,
        'Replace `open(path).read()` with `Path(path).read_text(encoding="utf-8")`.',
      )
    }

    // Check for open().write() pattern
    const fn = node.childForFieldName('function')
    if (fn?.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      const obj = fn.childForFieldName('object')
      if (attr?.text === 'write' && obj?.type === 'call') {
        const openFn = obj.childForFieldName('function')
        if (openFn?.text === 'open') {
          return makeViolation(
            this.ruleKey, node, filePath, 'low',
            'Verbose file write',
            '`open(...).write(...)` can be replaced with `Path(...).write_text(...)` (Python 3.4+).',
            sourceCode,
            'Replace `open(path).write(content)` with `Path(path).write_text(content, encoding="utf-8")`.',
          )
        }
      }
    }

    return null
  },
}
