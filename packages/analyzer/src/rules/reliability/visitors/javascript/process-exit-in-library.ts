import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const processExitInLibraryVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/process-exit-in-library',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const obj = fn.childForFieldName('object')
    const prop = fn.childForFieldName('property')
    if (obj?.text !== 'process' || prop?.text !== 'exit') return null

    // Allow in files that look like entry points
    const lowerPath = filePath.toLowerCase()
    if (
      lowerPath.includes('index.') ||
      lowerPath.includes('main.') ||
      lowerPath.includes('cli.') ||
      lowerPath.includes('bin/') ||
      lowerPath.includes('server.') ||
      lowerPath.includes('app.')
    ) {
      return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'process.exit() in non-entry-point code',
      'process.exit() terminates the entire process. Library code should throw errors instead.',
      sourceCode,
      'Throw an error instead of calling process.exit(), and let the caller decide how to handle it.',
    )
  },
}
