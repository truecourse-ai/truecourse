import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import {
  CSHARP_METHODLIKE_TYPES,
  getCSharpFunctionBody,
  getCSharpFunctionName,
  isCSharpEfMigration,
  isCSharpGeneratedSource,
} from './_helpers.js'

export const csharpTooManyLinesVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/too-many-lines',
  languages: ['csharp'],
  nodeTypes: CSHARP_METHODLIKE_TYPES,
  visit(node, filePath, sourceCode) {
    const bodyNode = getCSharpFunctionBody(node)
    if (!bodyNode) return null

    // Generated code — source-generator / T4 output and scaffolded EF Core
    // migrations — is regenerated wholesale, so its method length is inherent to
    // the generated content and not a maintainability signal for a human author.
    if (isCSharpGeneratedSource(filePath, sourceCode) || isCSharpEfMigration(node)) return null

    const lineCount = bodyNode.endPosition.row - bodyNode.startPosition.row + 1
    if (lineCount > 50) {
      const name = getCSharpFunctionName(node)
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Method too long',
        `Method \`${name}\` has ${lineCount} lines (max 50). Split into smaller, focused methods.`,
        sourceCode,
        'Extract logical sections into separate helper methods.',
      )
    }
    return null
  },
}
