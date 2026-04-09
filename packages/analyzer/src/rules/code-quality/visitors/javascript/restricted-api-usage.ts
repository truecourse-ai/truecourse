import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

/**
 * Detects restricted API usage patterns in JavaScript/TypeScript.
 * Flags usage of problematic globals, properties, and syntax patterns.
 */
const RESTRICTED_GLOBALS = new Map<string, string>([
  ['event', 'Implicit global event object — use explicit event parameter instead'],
  ['fdescribe', 'Focused test suite — will skip other tests in CI'],
  ['fit', 'Focused test — will skip other tests in CI'],
  ['location', 'Direct location mutation — use router navigation instead'],
])

const RESTRICTED_PROPERTIES = new Map<string, string>([
  ['__defineGetter__', 'Deprecated — use Object.defineProperty instead'],
  ['__defineSetter__', 'Deprecated — use Object.defineProperty instead'],
  ['__lookupGetter__', 'Deprecated — use Object.getOwnPropertyDescriptor instead'],
  ['__lookupSetter__', 'Deprecated — use Object.getOwnPropertyDescriptor instead'],
])

export const restrictedApiUsageVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/restricted-api-usage',
  languages: JS_LANGUAGES,
  nodeTypes: ['identifier', 'member_expression'],
  visit(node, filePath, sourceCode) {
    // Check restricted globals (only standalone identifiers at expression level)
    if (node.type === 'identifier') {
      const parent = node.parent
      if (!parent) return null

      // Only flag if used as a standalone expression or in a call, not as a property/declaration
      if (
        parent.type === 'member_expression' && parent.childForFieldName('property')?.id === node.id
      ) return null
      if (parent.type === 'variable_declarator' && parent.childForFieldName('name')?.id === node.id) return null
      if (parent.type === 'formal_parameters' || parent.type === 'required_parameter') return null
      if (parent.type === 'property_identifier') return null
      if (parent.type === 'import_specifier' || parent.type === 'export_specifier') return null

      // Skip if identifier is declared as a local variable or parameter in scope
      const declPattern = new RegExp(`\\b(?:const|let|var)\\s+${node.text}\\b`)
      let scope = node.parent
      while (scope) {
        if (scope.type === 'statement_block' || scope.type === 'program') {
          if (declPattern.test(scope.text)) return null
        }
        // Also check function parameters
        if (scope.type === 'arrow_function' || scope.type === 'function_declaration' ||
            scope.type === 'function_expression' || scope.type === 'method_definition') {
          const params = scope.childForFieldName('parameters')
          if (params && params.text.includes(node.text)) return null
          break
        }
        scope = scope.parent
      }

      const reason = RESTRICTED_GLOBALS.get(node.text)
      if (reason) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Restricted global usage',
          `Usage of global '${node.text}' — ${reason}.`,
          sourceCode,
          'Avoid using this global directly.',
        )
      }
    }

    // Check restricted properties
    if (node.type === 'member_expression') {
      const prop = node.childForFieldName('property')
      if (!prop) return null

      const reason = RESTRICTED_PROPERTIES.get(prop.text)
      if (reason) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Restricted API usage',
          `Usage of '${prop.text}' — ${reason}.`,
          sourceCode,
          'Use the recommended alternative.',
        )
      }
    }

    return null
  },
}
