import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isInsideLoop } from './_helpers.js'

export const jsonParseInLoopVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/json-parse-in-loop',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const obj = fn.childForFieldName('object')
    const prop = fn.childForFieldName('property')
    if (obj?.text !== 'JSON') return null
    if (prop?.text !== 'parse' && prop?.text !== 'stringify') return null

    if (!isInsideLoop(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      `JSON.${prop.text}() inside loop`,
      `JSON.${prop.text}() is expensive and calling it inside a loop degrades performance. Move it outside the loop if possible.`,
      sourceCode,
      `Cache the result of JSON.${prop.text}() outside the loop.`,
    )
  },
}
