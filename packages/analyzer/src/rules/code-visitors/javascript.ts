/**
 * JS/TS code rule visitors.
 */

import type { CodeRuleVisitor } from './common.js'
import { makeViolation } from './common.js'

export const emptyCatchVisitor: CodeRuleVisitor = {
  ruleKey: 'code/empty-catch',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['catch_clause'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null
    const statements = body.namedChildren.filter((c) => c.type !== 'comment')
    if (statements.length === 0) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Empty catch block',
        'This catch block swallows errors silently. Add error handling or at least log the error.',
        sourceCode,
        'Add error logging or re-throw the error in this catch block.',
      )
    }
    return null
  },
}

export const consoleLogVisitor: CodeRuleVisitor = {
  ruleKey: 'code/console-log',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null
    const obj = fn.childForFieldName('object')
    const prop = fn.childForFieldName('property')
    if (!obj || !prop) return null
    if (obj.text !== 'console') return null
    if (prop.text !== 'log' && prop.text !== 'debug') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      `console.${prop.text} call`,
      `console.${prop.text} should be removed or replaced with a proper logger in production code.`,
      sourceCode,
      'Replace console.log/debug with a structured logger or remove it.',
    )
  },
}

export const noExplicitAnyVisitor: CodeRuleVisitor = {
  ruleKey: 'code/no-explicit-any',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['type_annotation'],
  visit(node, filePath, sourceCode) {
    const typeNode = node.namedChildren[0]
    if (!typeNode) return null
    if (typeNode.type === 'predefined_type' && typeNode.text === 'any') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Explicit `any` type',
        'Using `: any` bypasses TypeScript type checking. Use a specific type or `unknown` instead.',
        sourceCode,
        'Replace `: any` with a specific type or `unknown`.',
      )
    }
    return null
  },
}

const QUERY_METHOD_NAMES = new Set([
  'query', 'execute', 'exec', 'raw', 'rawQuery',
  'sequelize', '$queryRaw', '$executeRaw',
])

export const sqlInjectionVisitor: CodeRuleVisitor = {
  ruleKey: 'code/sql-injection',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      if (prop) methodName = prop.text
    } else if (fn.type === 'identifier') {
      methodName = fn.text
    }

    if (!QUERY_METHOD_NAMES.has(methodName)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    if (firstArg.type === 'template_string') {
      const hasSubstitution = firstArg.namedChildren.some((c) => c.type === 'template_substitution')
      if (hasSubstitution) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Potential SQL injection',
          `Template literal with interpolation passed to ${methodName}(). Use parameterized queries instead.`,
          sourceCode,
          'Use parameterized queries (e.g., $1, ?) instead of string interpolation in SQL.',
        )
      }
    }

    if (firstArg.type === 'binary_expression') {
      const operator = firstArg.children.find((c) => c.type === '+')
      if (operator) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Potential SQL injection',
          `String concatenation passed to ${methodName}(). Use parameterized queries instead.`,
          sourceCode,
          'Use parameterized queries (e.g., $1, ?) instead of string concatenation in SQL.',
        )
      }
    }

    return null
  },
}

export const jsStarImportVisitor: CodeRuleVisitor = {
  ruleKey: 'code/star-import',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['import_statement'],
  visit(node, filePath, sourceCode) {
    const hasNamespaceImport = node.namedChildren.some(
      (c) => c.type === 'import_clause' && c.namedChildren.some((cc) => cc.type === 'namespace_import')
    )
    if (hasNamespaceImport) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Namespace import',
        'import * imports the entire module. Import only what you need for better tree-shaking and clarity.',
        sourceCode,
        'Replace import * with named imports for the specific symbols you use.',
      )
    }
    return null
  },
}

export const jsVarDeclarationVisitor: CodeRuleVisitor = {
  ruleKey: 'code/global-statement',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['variable_declaration'],
  visit(node, filePath, sourceCode) {
    if (!node.text.startsWith('var ')) return null

    let parent = node.parent
    while (parent) {
      if (parent.type === 'function_declaration' || parent.type === 'function_expression'
        || parent.type === 'arrow_function' || parent.type === 'method_definition') {
        const nameNode = node.namedChildren[0]?.childForFieldName('name')
        const name = nameNode?.text || 'variable'
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          '`var` declaration',
          `\`var ${name}\` is function-scoped, not block-scoped. Use \`let\` or \`const\` instead.`,
          sourceCode,
          'Replace `var` with `let` or `const` for block scoping.',
        )
      }
      parent = parent.parent
    }
    return null
  },
}

export const JS_VISITORS: CodeRuleVisitor[] = [
  emptyCatchVisitor,
  consoleLogVisitor,
  noExplicitAnyVisitor,
  sqlInjectionVisitor,
  jsStarImportVisitor,
  jsVarDeclarationVisitor,
]
