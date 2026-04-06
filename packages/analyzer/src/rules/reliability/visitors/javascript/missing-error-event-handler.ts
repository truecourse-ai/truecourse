import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { findContainingStatement } from './_helpers.js'

const EMITTER_CONSTRUCTORS = new Set([
  'createReadStream', 'createWriteStream', 'createServer',
  'createConnection', 'connect',
])

export const missingErrorEventHandlerVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/missing-error-event-handler',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let funcName = ''
    if (fn.type === 'identifier') {
      funcName = fn.text
    }

    // Look for createReadStream(), createServer(), etc.
    let methodName = ''
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      if (prop) methodName = prop.text
    }

    if (!EMITTER_CONSTRUCTORS.has(methodName) && !EMITTER_CONSTRUCTORS.has(funcName)) return null

    const name = methodName || funcName

    // Look at the parent to find if the result is stored, then check if .on('error') is called in scope
    // Simplified heuristic: check sibling statements for .on('error'
    const statement = findContainingStatement(node)
    if (!statement || !statement.parent) return null

    const siblings = statement.parent.namedChildren
    const stmtIndex = siblings.indexOf(statement)
    if (stmtIndex < 0) return null

    // Check the next few statements for .on('error'
    for (let i = stmtIndex; i < Math.min(stmtIndex + 5, siblings.length); i++) {
      const sib = siblings[i]
      if (!sib) continue
      const sibText = sib.text
      if (sibText.includes(".on('error'") || sibText.includes('.on("error"') || sibText.includes('.on(`error`)')) {
        return null
      }
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Missing error event handler',
      `${name}() creates an EventEmitter/Stream without a nearby .on('error') handler.`,
      sourceCode,
      "Add .on('error', handler) to prevent unhandled error events from crashing the process.",
    )
  },
}
