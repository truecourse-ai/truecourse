import type { SyntaxNode } from 'tree-sitter'
import type { CodeViolation } from '@truecourse/shared'

export interface CodeRuleVisitor {
  ruleKey: string
  nodeTypes: string[]
  visit(node: SyntaxNode, filePath: string, sourceCode: string): CodeViolation | null
}

function makeViolation(
  ruleKey: string,
  node: SyntaxNode,
  filePath: string,
  severity: string,
  title: string,
  content: string,
  sourceCode: string,
  fixPrompt?: string,
): CodeViolation {
  const lineStart = node.startPosition.row + 1
  const lineEnd = node.endPosition.row + 1
  const lines = sourceCode.split('\n')
  const snippetLines = lines.slice(node.startPosition.row, Math.min(node.endPosition.row + 1, node.startPosition.row + 3))
  const snippet = snippetLines.join('\n')

  return {
    ruleKey,
    filePath,
    lineStart,
    lineEnd,
    columnStart: node.startPosition.column,
    columnEnd: node.endPosition.column,
    severity,
    title,
    content,
    snippet,
    fixPrompt,
  }
}

// ---------------------------------------------------------------------------
// Visitors
// ---------------------------------------------------------------------------

export const emptyCatchVisitor: CodeRuleVisitor = {
  ruleKey: 'code/empty-catch',
  nodeTypes: ['catch_clause'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null
    // Empty if no named children (statements) in the block
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

const SECRET_PATTERNS = [
  /^(?:sk|pk)[-_](?:live|test)[-_]/i,
  /^(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/,
  /^(?:eyJ)[A-Za-z0-9_-]{20,}\.eyJ/,
  /^AKIA[0-9A-Z]{16}/,
  /^xox[bporsac]-[0-9]{10,}/,
  /(?:password|passwd|secret|api_?key|apikey|token|auth)[\s]*[:=][\s]*['"][^'"]{8,}['"]/i,
]

export const hardcodedSecretVisitor: CodeRuleVisitor = {
  ruleKey: 'code/hardcoded-secret',
  nodeTypes: ['string', 'template_string'],
  visit(node, filePath, sourceCode) {
    const text = node.text
    // Strip quotes
    const value = text.slice(1, -1)
    if (value.length < 8) return null

    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(value)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'critical',
          'Hardcoded secret detected',
          'This string looks like a hardcoded API key, token, or password. Use environment variables instead.',
          sourceCode,
          'Move this secret to an environment variable and reference it via process.env.',
        )
      }
    }

    // Check parent assignment for secret-like variable names
    const parent = node.parent
    if (parent) {
      const varDeclarator = parent.type === 'variable_declarator' ? parent : null
      const assignment = parent.type === 'assignment_expression' ? parent : null
      const propAssignment = parent.type === 'pair' ? parent : null

      let nameNode = varDeclarator?.childForFieldName('name')
        || assignment?.childForFieldName('left')
        || propAssignment?.childForFieldName('key')

      if (nameNode) {
        const name = nameNode.text.toLowerCase()
        const secretNames = ['password', 'passwd', 'secret', 'apikey', 'api_key', 'token', 'auth_token', 'access_token', 'private_key']
        if (secretNames.some((s) => name.includes(s)) && value.length >= 8 && !/^(true|false|null|undefined|localhost|https?:\/\/)/.test(value)) {
          return makeViolation(
            this.ruleKey, node, filePath, 'critical',
            'Hardcoded secret detected',
            `Variable "${nameNode.text}" contains what appears to be a hardcoded secret. Use environment variables instead.`,
            sourceCode,
            'Move this secret to an environment variable and reference it via process.env.',
          )
        }
      }
    }

    return null
  },
}

export const todoFixmeVisitor: CodeRuleVisitor = {
  ruleKey: 'code/todo-fixme',
  nodeTypes: ['comment'],
  visit(node, filePath, sourceCode) {
    const text = node.text
    const match = text.match(/\b(TODO|FIXME|HACK)\b/i)
    if (!match) return null

    const tag = match[1].toUpperCase()
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      `${tag} comment`,
      `${tag} comment found: ${text.trim().slice(0, 100)}`,
      sourceCode,
    )
  },
}

const ALLOWED_NUMBERS = new Set([0, 1, -1, 2])

export const magicNumberVisitor: CodeRuleVisitor = {
  ruleKey: 'code/magic-number',
  nodeTypes: ['number'],
  visit(node, filePath, sourceCode) {
    const value = Number(node.text)
    if (isNaN(value) || ALLOWED_NUMBERS.has(value)) return null

    // Check if inside a const declaration
    let current = node.parent
    while (current) {
      if (current.type === 'lexical_declaration') {
        // Check if it's const
        const kindNode = current.children[0]
        if (kindNode && kindNode.text === 'const') return null
        break
      }
      if (current.type === 'variable_declaration') break
      // Allow in enum members
      if (current.type === 'enum_declaration' || current.type === 'enum_body') return null
      // Allow in array indices and common patterns
      if (current.type === 'subscript_expression') return null
      // Allow in type annotations
      if (current.type === 'type_annotation') return null
      current = current.parent
    }

    // Skip if inside default parameter values
    current = node.parent
    while (current) {
      if (current.type === 'required_parameter' || current.type === 'optional_parameter') {
        if (node.parent?.type === 'assignment_pattern') return null
      }
      if (current.type === 'function_declaration' || current.type === 'arrow_function' || current.type === 'method_definition') break
      current = current.parent
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      `Magic number: ${node.text}`,
      `Numeric literal ${node.text} should be extracted to a named constant for clarity.`,
      sourceCode,
      `Extract ${node.text} into a named constant.`,
    )
  },
}

export const noExplicitAnyVisitor: CodeRuleVisitor = {
  ruleKey: 'code/no-explicit-any',
  nodeTypes: ['type_annotation'],
  visit(node, filePath, sourceCode) {
    // Check if the type is literally `any`
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

    // Flag template literals with expressions (interpolation)
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

    // Flag string concatenation (binary_expression with +)
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

export const ALL_CODE_VISITORS: CodeRuleVisitor[] = [
  emptyCatchVisitor,
  consoleLogVisitor,
  hardcodedSecretVisitor,
  todoFixmeVisitor,
  magicNumberVisitor,
  noExplicitAnyVisitor,
  sqlInjectionVisitor,
]
