import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const testExclusiveVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/test-exclusive',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    // Detect: describe.only(...), it.only(...), test.only(...), fit(...), fdescribe(...)
    if (fn.type === 'member_expression') {
      const obj = fn.childForFieldName('object')
      const prop = fn.childForFieldName('property')

      if (
        prop?.text === 'only' &&
        (obj?.text === 'it' || obj?.text === 'test' || obj?.text === 'describe')
      ) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          `Exclusive test: ${obj.text}.only()`,
          `\`${obj.text}.only()\` is committed to version control — this will skip all other tests when run.`,
          sourceCode,
          `Change \`${obj.text}.only\` to \`${obj.text}\`.`,
        )
      }
    }

    // Detect fit(...) and fdescribe(...)
    if (fn.type === 'identifier' && (fn.text === 'fit' || fn.text === 'fdescribe')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        `Exclusive test: ${fn.text}()`,
        `\`${fn.text}()\` is committed to version control — this will skip all other tests when run.`,
        sourceCode,
        `Change \`${fn.text}\` to \`${fn.text.slice(1)}\`.`,
      )
    }

    return null
  },
}
