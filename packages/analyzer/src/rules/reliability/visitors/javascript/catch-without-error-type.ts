import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const catchWithoutErrorTypeVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/catch-without-error-type',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['catch_clause'],
  visit(node, filePath, sourceCode) {
    // Get the catch parameter
    const param = node.childForFieldName('parameter')
    if (!param) {
      // catch without parameter at all — also a problem but less common
      return null
    }

    // If the catch body checks instanceof or typeof, it's fine
    const body = node.childForFieldName('body')
    if (!body) return null
    const bodyText = body.text
    if (bodyText.includes('instanceof') || bodyText.includes('typeof')) return null

    const hasTypeAnnotation = node.childForFieldName('type') !== null
    if (hasTypeAnnotation) return null

    // Short handlers - one statement that logs, returns a default, or
    // re-throws - aren't doing branching work that benefits from type
    // discrimination. Flagging them is noise: `safeParse` / `safeRun`
    // wrappers, the most common JS try/catch pattern in app code, would
    // all fire even though they're correctly written. Restrict the rule
    // to bodies with multiple statements where discrimination would
    // actually change behaviour.
    const stmts = body.namedChildren.filter(
      (c) => c.type !== 'comment',
    )
    if (stmts.length <= 1) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Catch without error type discrimination',
      'Catch block does not check or narrow the error type. Different error types may need different handling.',
      sourceCode,
      'Use instanceof checks or type guards in the catch block to handle specific error types.',
    )
  },
}
