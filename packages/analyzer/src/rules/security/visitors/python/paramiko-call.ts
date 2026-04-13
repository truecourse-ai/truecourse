import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { containsPythonIdentifierExact, getPythonModuleNode } from '../../../_shared/python-helpers.js'
import { getPythonImportSources } from '../../../_shared/python-framework-detection.js'

export const pythonParamikoCallVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/paramiko-call',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      if (attr) methodName = attr.text
    }

    if (methodName !== 'connect') return null

    // Verify paramiko is used in this file — check imports first, then fall
    // back to checking if `paramiko` appears as an identifier (for snippets
    // without explicit import statements).
    const sources = getPythonImportSources(node)
    let hasParamiko = false
    for (const src of sources) {
      if (src === 'paramiko' || src.startsWith('paramiko.')) {
        hasParamiko = true
        break
      }
    }
    if (!hasParamiko) {
      // Fallback: check if 'paramiko' is referenced as an identifier in the file
      // (handles snippets without explicit import statements)
      hasParamiko = containsPythonIdentifierExact(getPythonModuleNode(node), 'paramiko')
    }
    if (!hasParamiko) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Check if AutoAddPolicy or WarningPolicy is referenced in a nearby scope
    let hasAutoAddPolicy = false
    let parent = node.parent
    let depth = 0
    while (parent && depth < 10) {
      if (containsPythonIdentifierExact(parent, 'AutoAddPolicy') ||
          containsPythonIdentifierExact(parent, 'WarningPolicy')) {
        hasAutoAddPolicy = true
        break
      }
      parent = parent.parent
      depth++
    }

    if (hasAutoAddPolicy) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Paramiko without host key verification',
        'Paramiko SSH client is connecting without strict host key verification (AutoAddPolicy or WarningPolicy).',
        sourceCode,
        'Use RejectPolicy or explicitly load known_hosts: client.load_system_host_keys().',
      )
    }

    return null
  },
}
