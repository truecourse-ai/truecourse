import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const sessionNotRegeneratedVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/session-not-regenerated',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    // Look for login-like functions that don't call req.session.regenerate()
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      const obj = fn.childForFieldName('object')
      if (!prop || !obj) return null

      // req.session.save() or req.session.destroy() in a login handler
      // without regenerate() being called — detect direct session assignment after auth
      // Pattern: req.session.userId = ... or req.session.user = ... without regenerate
      if (prop.text === 'save' && obj.type === 'member_expression') {
        const sessionProp = obj.childForFieldName('property')
        if (sessionProp?.text === 'session') {
          // Walk up to the nearest route handler function body and check for regenerate
          let parent = node.parent
          while (parent) {
            // Collect all ancestor blocks until we reach a function that looks like a route handler
            if (parent.type === 'arrow_function' || parent.type === 'function_expression' ||
                parent.type === 'function_declaration') {
              // Keep walking up to find enclosing route-level function
              if (parent.parent?.type === 'arguments' || parent.parent?.type === 'call_expression') {
                // Check whether the surrounding call chain includes regenerate
                let ancestor = parent.parent
                while (ancestor) {
                  if (ancestor.text.replace(/\/\/.*$/gm, '').includes('regenerate')) break
                  if (ancestor.type === 'program' || ancestor.type === 'module') {
                    return makeViolation(
                      this.ruleKey, node, filePath, 'high',
                      'Session not regenerated after login',
                      'req.session.save() called without regenerating the session ID. This risks session fixation attacks.',
                      sourceCode,
                      'Call req.session.regenerate() before saving session data after login.',
                    )
                  }
                  ancestor = ancestor.parent!
                }
                return null
              }
            }
            if (parent.type === 'program' || parent.type === 'module') break
            parent = parent.parent!
          }
        }
      }
    }

    return null
  },
}
