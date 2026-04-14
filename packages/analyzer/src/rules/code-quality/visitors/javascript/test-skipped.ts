import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const testSkippedVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/test-skipped',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    // Detect: describe.skip(...), it.skip(...), test.skip(...), xit(...), xdescribe(...)
    if (fn.type === 'member_expression') {
      const obj = fn.childForFieldName('object')
      const prop = fn.childForFieldName('property')

      if (
        prop?.text === 'skip' &&
        (obj?.text === 'it' || obj?.text === 'test' || obj?.text === 'describe')
      ) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          `Skipped test: ${obj.text}.skip()`,
          `\`${obj.text}.skip()\` is committed — skipped tests are not run and may hide broken functionality.`,
          sourceCode,
          `Fix the test and remove \`.skip\`, or document why it is skipped with a comment.`,
        )
      }
    }

    // Detect xit(...) and xdescribe(...)
    if (fn.type === 'identifier' && (fn.text === 'xit' || fn.text === 'xdescribe' || fn.text === 'xtest')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        `Skipped test: ${fn.text}()`,
        `\`${fn.text}()\` is a skipped test committed to version control.`,
        sourceCode,
        `Fix the test and use \`${fn.text.slice(1)}\` instead.`,
      )
    }

    return null
  },
}
