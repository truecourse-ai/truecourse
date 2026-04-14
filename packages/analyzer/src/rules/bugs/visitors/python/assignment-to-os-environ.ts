import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonAssignmentToOsEnvironVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/assignment-to-os-environ',
  languages: ['python'],
  nodeTypes: ['assignment'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    if (!left) return null

    if (left.type === 'attribute' &&
        left.childForFieldName('object')?.text === 'os' &&
        left.childForFieldName('attribute')?.text === 'environ') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Direct assignment to os.environ',
        '`os.environ = {...}` replaces the entire environment mapping object — future changes may not propagate. Use `os.environ.update({...})` instead.',
        sourceCode,
        'Replace `os.environ = {...}` with `os.environ.update({...})`.',
      )
    }
    return null
  },
}
