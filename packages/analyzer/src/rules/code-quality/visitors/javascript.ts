/**
 * Code quality domain JS/TS visitors.
 */

import type { CodeRuleVisitor } from '../../types.js'
import { makeViolation } from '../../types.js'

export const consoleLogVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/console-log',
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
  ruleKey: 'code-quality/deterministic/no-explicit-any',
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

export const jsStarImportVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/star-import',
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
  ruleKey: 'code-quality/deterministic/global-statement',
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

export const nestedTernaryVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/nested-ternary',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['ternary_expression'],
  visit(node, filePath, sourceCode) {
    // Check if any child ternary_expression exists (nested ternary)
    const consequence = node.childForFieldName('consequence')
    const alternative = node.childForFieldName('alternative')

    function containsTernary(n: import('tree-sitter').SyntaxNode): boolean {
      if (n.type === 'ternary_expression') return true
      // Check inside parenthesized expressions
      if (n.type === 'parenthesized_expression') {
        for (let i = 0; i < n.namedChildCount; i++) {
          const child = n.namedChild(i)
          if (child && containsTernary(child)) return true
        }
      }
      return false
    }

    const hasTernaryChild = (consequence && containsTernary(consequence)) ||
      (alternative && containsTernary(alternative))

    if (hasTernaryChild) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Nested ternary expression',
        'Ternary inside a ternary is hard to read. Use if/else or extract the logic into a helper function.',
        sourceCode,
        'Replace nested ternary with if/else or a helper function.',
      )
    }
    return null
  },
}

export const nestedTemplateLiteralVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/nested-template-literal',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['template_string'],
  visit(node, filePath, sourceCode) {
    // Check if any template_substitution contains another template_string
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child?.type === 'template_substitution') {
        function hasNestedTemplate(n: import('tree-sitter').SyntaxNode): boolean {
          if (n.type === 'template_string') return true
          for (let j = 0; j < n.namedChildCount; j++) {
            const c = n.namedChild(j)
            if (c && hasNestedTemplate(c)) return true
          }
          return false
        }
        if (hasNestedTemplate(child)) {
          return makeViolation(
            this.ruleKey, node, filePath, 'medium',
            'Nested template literal',
            'Template literal inside another template literal is hard to read. Extract the inner expression to a variable.',
            sourceCode,
            'Extract the inner template literal to a variable.',
          )
        }
      }
    }
    return null
  },
}

export const tooManyReturnStatementsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/too-many-return-statements',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['function_declaration', 'function_expression', 'arrow_function', 'method_definition'],
  visit(node, filePath, sourceCode) {
    let returnCount = 0
    const MAX_RETURNS = 5

    // For method_definition, the body is inside the function node
    const bodyNode = node.type === 'method_definition'
      ? node.namedChildren.find((c) => c.type === 'statement_block')
      : node.childForFieldName('body')

    if (!bodyNode) return null

    function countReturns(n: import('tree-sitter').SyntaxNode) {
      if (n.type === 'return_statement') {
        returnCount++
        return
      }
      // Don't descend into nested functions
      if (n !== bodyNode && (n.type === 'function_declaration' || n.type === 'function_expression'
        || n.type === 'arrow_function' || n.type === 'method_definition')) return

      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) countReturns(child)
      }
    }

    countReturns(bodyNode)

    if (returnCount > MAX_RETURNS) {
      const nameNode = node.childForFieldName('name')
      const name = nameNode?.text || 'anonymous'
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Too many return statements',
        `Function \`${name}\` has ${returnCount} return statements (max ${MAX_RETURNS}). Consider refactoring to reduce complexity.`,
        sourceCode,
        'Refactor to reduce the number of return statements, e.g., using early returns, lookup tables, or extracting logic.',
      )
    }
    return null
  },
}

export const collapsibleIfVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/collapsible-if',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    // Check: if (a) { if (b) { ... } } with no else on either if
    const hasElse = node.children.some((c) => c.type === 'else_clause')
    if (hasElse) return null

    const consequence = node.childForFieldName('consequence')
    if (!consequence || consequence.type !== 'statement_block') return null

    // The block should have exactly one named child which is an if_statement
    const namedChildren = consequence.namedChildren
    if (namedChildren.length !== 1) return null
    const innerIf = namedChildren[0]
    if (innerIf.type !== 'if_statement') return null

    // The inner if should have no else
    const innerHasElse = innerIf.children.some((c) => c.type === 'else_clause')
    if (innerHasElse) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Collapsible if statements',
      'Nested if without else can be combined: `if (a && b) { ... }`. This reduces nesting and improves readability.',
      sourceCode,
      'Combine the conditions with && into a single if statement.',
    )
  },
}

export const redundantBooleanVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/redundant-boolean',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    // Pattern: if (x) { return true; } else { return false; }
    // or: if (x) return true; else return false;
    const consequence = node.childForFieldName('consequence')
    const elseClause = node.children.find((c) => c.type === 'else_clause')
    if (!consequence || !elseClause) return null

    function getReturnValue(block: import('tree-sitter').SyntaxNode): string | null {
      let target = block
      // If it's a statement block, it should contain exactly one return statement
      if (target.type === 'statement_block') {
        const stmts = target.namedChildren
        if (stmts.length !== 1 || stmts[0].type !== 'return_statement') return null
        target = stmts[0]
      }
      if (target.type !== 'return_statement') return null
      const value = target.namedChildren[0]
      if (!value) return null
      return value.text
    }

    const trueVal = getReturnValue(consequence)
    const elseBody = elseClause.namedChildren[0]
    if (!elseBody) return null
    const falseVal = getReturnValue(elseBody)

    if ((trueVal === 'true' && falseVal === 'false') || (trueVal === 'false' && falseVal === 'true')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Redundant boolean return',
        'if/else returning true/false can be simplified to `return <condition>` or `return !<condition>`.',
        sourceCode,
        'Replace with `return <condition>` or `return !<condition>`.',
      )
    }
    return null
  },
}

export const unnecessaryElseAfterReturnVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-else-after-return',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    const consequence = node.childForFieldName('consequence')
    const elseClause = node.children.find((c) => c.type === 'else_clause')
    if (!consequence || !elseClause) return null

    // Skip if the else body is another if_statement (else if chain)
    const elseBody = elseClause.namedChildren[0]
    if (elseBody?.type === 'if_statement') return null

    // Check if consequence ends with a return statement
    function endsWithReturn(block: import('tree-sitter').SyntaxNode): boolean {
      if (block.type === 'return_statement') return true
      if (block.type === 'statement_block') {
        const stmts = block.namedChildren
        if (stmts.length > 0 && stmts[stmts.length - 1].type === 'return_statement') return true
      }
      return false
    }

    // Skip if this is a redundant-boolean pattern (let that rule handle it)
    function getReturnValue(block: import('tree-sitter').SyntaxNode): string | null {
      let target = block
      if (target.type === 'statement_block') {
        const stmts = target.namedChildren
        if (stmts.length !== 1 || stmts[0].type !== 'return_statement') return null
        target = stmts[0]
      }
      if (target.type !== 'return_statement') return null
      const value = target.namedChildren[0]
      return value?.text ?? null
    }

    if (endsWithReturn(consequence)) {
      const trueVal = getReturnValue(consequence)
      const falseVal = elseBody ? getReturnValue(elseBody) : null
      if ((trueVal === 'true' && falseVal === 'false') || (trueVal === 'false' && falseVal === 'true')) {
        return null // Let redundant-boolean handle this
      }

      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Unnecessary else after return',
        'The else block is unnecessary because the if branch returns. Move the else body to the outer scope.',
        sourceCode,
        'Remove the else wrapper — the code after the if block will only run when the condition is false.',
      )
    }
    return null
  },
}

export const jsNoEmptyFunctionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-empty-function',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['function_declaration', 'function_expression', 'arrow_function', 'method_definition'],
  visit(node, filePath, sourceCode) {
    const bodyNode = node.type === 'method_definition'
      ? node.namedChildren.find((c) => c.type === 'statement_block')
      : node.childForFieldName('body')

    if (!bodyNode || bodyNode.type !== 'statement_block') return null

    // Check if the block has no named children (no statements)
    if (bodyNode.namedChildren.length > 0) return null

    // Check if there are any comments inside the block
    for (let i = 0; i < bodyNode.childCount; i++) {
      const child = bodyNode.child(i)
      if (child && child.type === 'comment') return null
    }

    const nameNode = node.childForFieldName('name')
    const name = nameNode?.text || 'anonymous'

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Empty function body',
      `Function \`${name}\` has an empty body. Add an implementation or a comment explaining why it's empty.`,
      sourceCode,
      'Add an implementation, throw a "not implemented" error, or add a comment explaining why the body is empty.',
    )
  },
}

export const noUselessCatchVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-useless-catch',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['catch_clause'],
  visit(node, filePath, sourceCode) {
    const paramNode = node.childForFieldName('parameter')
    const bodyNode = node.childForFieldName('body')
    if (!paramNode || !bodyNode) return null

    // The body should have exactly one statement: throw <same identifier>
    const stmts = bodyNode.namedChildren
    if (stmts.length !== 1) return null
    const stmt = stmts[0]
    if (stmt.type !== 'throw_statement') return null

    const thrownExpr = stmt.namedChildren[0]
    if (!thrownExpr) return null

    // Compare the thrown identifier to the catch parameter
    const paramName = paramNode.text
    if (thrownExpr.type === 'identifier' && thrownExpr.text === paramName) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Useless catch clause',
        `catch(${paramName}) only re-throws the error. Remove the try/catch or add error handling/context.`,
        sourceCode,
        'Remove the try/catch block, or add error handling, logging, or wrapping before re-throwing.',
      )
    }
    return null
  },
}

export const preferTemplateLiteralVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/prefer-template-literal',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    // Check: string + expression or expression + string using +
    const operator = node.children.find((c) => c.type === '+')
    if (!operator) return null

    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (!left || !right) return null

    // At least one side should be a string literal, and the other should not be a string literal
    const leftIsString = left.type === 'string'
    const rightIsString = right.type === 'string'

    if (!leftIsString && !rightIsString) return null
    // If both are strings, that's just string concat of two literals — less useful to flag
    if (leftIsString && rightIsString) return null

    // Don't fire if this binary_expression is itself the child of another + binary_expression
    // to avoid multiple violations for the same concatenation chain — only fire on the outermost
    const parent = node.parent
    if (parent?.type === 'binary_expression') {
      const parentOp = parent.children.find((c) => c.type === '+')
      if (parentOp) return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'String concatenation',
      'String concatenation with `+` can be replaced with a template literal for better readability.',
      sourceCode,
      'Replace string concatenation with a template literal: `text ${expr}`.',
    )
  },
}

export const noVarDeclarationVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-var-declaration',
  languages: ['javascript'],
  nodeTypes: ['variable_declaration'],
  visit(node, filePath, sourceCode) {
    if (!node.text.startsWith('var ')) return null

    const nameNode = node.namedChildren[0]?.childForFieldName('name')
    const name = nameNode?.text || 'variable'
    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      '`var` declaration',
      `\`var ${name}\` is function-scoped and error-prone. Use \`let\` or \`const\` instead.`,
      sourceCode,
      'Replace `var` with `let` or `const`.',
    )
  },
}

// ---------------------------------------------------------------------------
// New rules
// ---------------------------------------------------------------------------

type SyntaxNode = import('tree-sitter').SyntaxNode

const JS_FUNCTION_TYPES = ['function_declaration', 'function_expression', 'arrow_function', 'method_definition']

function getFunctionBody(node: SyntaxNode): SyntaxNode | null {
  if (node.type === 'method_definition') {
    return node.namedChildren.find((c) => c.type === 'statement_block') ?? null
  }
  return node.childForFieldName('body')
}

function getFunctionName(node: SyntaxNode): string {
  const nameNode = node.childForFieldName('name')
  return nameNode?.text || 'anonymous'
}

export const cognitiveComplexityVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/cognitive-complexity',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: JS_FUNCTION_TYPES,
  visit(node, filePath, sourceCode) {
    const bodyNode = getFunctionBody(node)
    if (!bodyNode) return null

    let complexity = 0
    const NESTING_TYPES = new Set(['if_statement', 'for_statement', 'for_in_statement', 'while_statement', 'do_statement', 'switch_statement', 'catch_clause', 'ternary_expression'])
    const INCREMENT_TYPES = new Set(['if_statement', 'for_statement', 'for_in_statement', 'while_statement', 'do_statement', 'switch_statement', 'catch_clause', 'ternary_expression'])

    function walk(n: SyntaxNode, nesting: number) {
      if (JS_FUNCTION_TYPES.includes(n.type) && n !== node) return

      if (INCREMENT_TYPES.has(n.type)) {
        complexity += 1 + nesting
      }
      // else_clause adds 1 but no nesting increment
      if (n.type === 'else_clause') {
        complexity += 1
      }
      // Logical operators && and || add 1 each
      if (n.type === 'binary_expression') {
        const op = n.children.find((c) => c.type === '&&' || c.type === '||')
        if (op) complexity += 1
      }

      const nextNesting = NESTING_TYPES.has(n.type) ? nesting + 1 : nesting
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child, nextNesting)
      }
    }

    walk(bodyNode, 0)

    if (complexity > 15) {
      const name = getFunctionName(node)
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'High cognitive complexity',
        `Function \`${name}\` has cognitive complexity ${complexity} (max 15). Simplify by extracting helper functions or reducing nesting.`,
        sourceCode,
        'Break the function into smaller, focused helper functions.',
      )
    }
    return null
  },
}

export const cyclomaticComplexityVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/cyclomatic-complexity',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: JS_FUNCTION_TYPES,
  visit(node, filePath, sourceCode) {
    const bodyNode = getFunctionBody(node)
    if (!bodyNode) return null

    let complexity = 1 // Start at 1 for the function itself
    const DECISION_TYPES = new Set(['if_statement', 'for_statement', 'for_in_statement', 'while_statement', 'do_statement', 'catch_clause', 'ternary_expression'])

    function walk(n: SyntaxNode) {
      if (JS_FUNCTION_TYPES.includes(n.type) && n !== node) return
      if (DECISION_TYPES.has(n.type)) complexity++
      // switch_case (each case adds a path)
      if (n.type === 'switch_case') complexity++
      // Logical && and || each add a path
      if (n.type === 'binary_expression') {
        const op = n.children.find((c) => c.type === '&&' || c.type === '||')
        if (op) complexity++
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child)
      }
    }

    walk(bodyNode)

    if (complexity > 10) {
      const name = getFunctionName(node)
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'High cyclomatic complexity',
        `Function \`${name}\` has cyclomatic complexity ${complexity} (max 10). Consider splitting into smaller functions.`,
        sourceCode,
        'Reduce decision points by extracting logic into helper functions or using lookup tables.',
      )
    }
    return null
  },
}

export const tooManyLinesVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/too-many-lines',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: JS_FUNCTION_TYPES,
  visit(node, filePath, sourceCode) {
    const bodyNode = getFunctionBody(node)
    if (!bodyNode) return null

    const lineCount = bodyNode.endPosition.row - bodyNode.startPosition.row + 1
    if (lineCount > 50) {
      const name = getFunctionName(node)
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Function too long',
        `Function \`${name}\` has ${lineCount} lines (max 50). Split into smaller, focused functions.`,
        sourceCode,
        'Extract logical sections into separate helper functions.',
      )
    }
    return null
  },
}

export const tooManyBranchesVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/too-many-branches',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: JS_FUNCTION_TYPES,
  visit(node, filePath, sourceCode) {
    const bodyNode = getFunctionBody(node)
    if (!bodyNode) return null

    let branchCount = 0
    const BRANCH_TYPES = new Set(['if_statement', 'else_clause', 'switch_case'])

    function walk(n: SyntaxNode) {
      if (JS_FUNCTION_TYPES.includes(n.type) && n !== node) return
      if (BRANCH_TYPES.has(n.type)) branchCount++
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child)
      }
    }

    walk(bodyNode)

    if (branchCount > 10) {
      const name = getFunctionName(node)
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Too many branches',
        `Function \`${name}\` has ${branchCount} branches (max 10). Consider using lookup tables or extracting logic.`,
        sourceCode,
        'Reduce branches by extracting logic, using strategy patterns, or lookup tables.',
      )
    }
    return null
  },
}

export const nestedSwitchVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/nested-switch',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['switch_statement'],
  visit(node, filePath, sourceCode) {
    // Check if any ancestor is also a switch_statement
    let parent = node.parent
    while (parent) {
      if (parent.type === 'switch_statement') {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Nested switch statement',
          'Switch inside another switch is hard to read. Extract the inner switch into a helper function.',
          sourceCode,
          'Extract the inner switch into a separate function.',
        )
      }
      parent = parent.parent
    }
    return null
  },
}

export const deeplyNestedFunctionsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/deeply-nested-functions',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['function_declaration', 'function_expression', 'arrow_function'],
  visit(node, filePath, sourceCode) {
    let depth = 0
    let parent = node.parent
    while (parent) {
      if (parent.type === 'function_declaration' || parent.type === 'function_expression'
        || parent.type === 'arrow_function' || parent.type === 'method_definition') {
        depth++
      }
      parent = parent.parent
    }

    if (depth >= 3) {
      const name = getFunctionName(node)
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Deeply nested function',
        `Function \`${name}\` is nested ${depth} levels deep. Extract to module scope for better readability.`,
        sourceCode,
        'Move the function to module scope or a separate file.',
      )
    }
    return null
  },
}

export const duplicateStringVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/duplicate-string',
  languages: ['typescript', 'tsx', 'javascript'],
  // Use program to scan the whole file once
  nodeTypes: ['program'],
  visit(node, filePath, sourceCode) {
    const stringCounts = new Map<string, { count: number; firstNode: SyntaxNode }>()

    function walk(n: SyntaxNode) {
      if (n.type === 'string') {
        // Get the text content without quotes
        const content = n.text
        // Skip short strings (1-2 chars inside quotes, e.g., "" or "x")
        if (content.length <= 3) return
        // Skip import/require strings
        const parent = n.parent
        if (parent?.type === 'import_statement' || parent?.type === 'call_expression') return

        const existing = stringCounts.get(content)
        if (existing) {
          existing.count++
        } else {
          stringCounts.set(content, { count: 1, firstNode: n })
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child)
      }
    }

    walk(node)

    // Report the first string that appears 3+ times
    for (const [content, info] of stringCounts) {
      if (info.count >= 3) {
        return makeViolation(
          this.ruleKey, info.firstNode, filePath, 'low',
          'Duplicate string literal',
          `String ${content} appears ${info.count} times. Extract to a named constant.`,
          sourceCode,
          'Extract the repeated string into a constant variable.',
        )
      }
    }
    return null
  },
}

export const unusedExpressionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unused-expression',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['expression_statement'],
  visit(node, filePath, sourceCode) {
    const expr = node.namedChildren[0]
    if (!expr) return null

    // Skip call expressions (they have side effects)
    if (expr.type === 'call_expression') return null
    // Skip assignment expressions
    if (expr.type === 'assignment_expression') return null
    // Skip augmented assignment (+=, etc.)
    if (expr.type === 'augmented_assignment_expression') return null
    // Skip update expressions (i++, --i)
    if (expr.type === 'update_expression') return null
    // Skip await expressions
    if (expr.type === 'await_expression') return null
    // Skip yield expressions
    if (expr.type === 'yield_expression') return null
    // Skip delete expressions
    if (expr.type === 'unary_expression' && expr.children[0]?.text === 'delete') return null
    // Skip void expressions (handled by no-void)
    if (expr.type === 'unary_expression' && expr.children[0]?.text === 'void') return null
    // Skip string literals that are directives (first statement in function/program)
    if (expr.type === 'string') {
      const parent = node.parent
      if (parent) {
        const idx = parent.namedChildren.indexOf(node)
        if (idx === 0) return null // likely a directive like "use strict"
      }
    }
    // Skip template literals (could have side effects via tagged templates)
    if (expr.type === 'template_string') return null
    // Skip new expressions (constructor side effects)
    if (expr.type === 'new_expression') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Unused expression',
      `Expression \`${expr.text.slice(0, 50)}\` has no effect. Did you forget to assign or use the result?`,
      sourceCode,
      'Assign the result to a variable, use it in a condition, or remove the expression.',
    )
  },
}

export const redundantJumpVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/redundant-jump',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['return_statement', 'continue_statement'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'return_statement') {
      // return with a value is not redundant
      if (node.namedChildren.length > 0) return null
      // Check if this is the last statement in the function body
      const parent = node.parent
      if (!parent) return null
      const stmts = parent.namedChildren
      if (stmts[stmts.length - 1] !== node) return null
      // parent should be a statement_block that is a function body
      const grandparent = parent.parent
      if (!grandparent) return null
      if (!JS_FUNCTION_TYPES.includes(grandparent.type)) return null

      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Redundant return',
        'return at the end of a void function is unnecessary.',
        sourceCode,
        'Remove the redundant return statement.',
      )
    }

    if (node.type === 'continue_statement') {
      // Check if this continue is the last statement in its loop body
      const parent = node.parent
      if (!parent) return null
      const stmts = parent.namedChildren
      if (stmts[stmts.length - 1] !== node) return null

      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Redundant continue',
        'continue at the end of a loop body is unnecessary.',
        sourceCode,
        'Remove the redundant continue statement.',
      )
    }

    return null
  },
}

export const noScriptUrlVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-script-url',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['string', 'template_string'],
  visit(node, filePath, sourceCode) {
    const text = node.text
    if (/javascript\s*:/i.test(text)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Script URL',
        '`javascript:` URLs are a form of eval. Use event handlers instead.',
        sourceCode,
        'Replace javascript: URL with an event handler or proper navigation.',
      )
    }
    return null
  },
}

export const noThrowLiteralVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-throw-literal',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['throw_statement'],
  visit(node, filePath, sourceCode) {
    const expr = node.namedChildren[0]
    if (!expr) return null
    // Flag if throwing a string, number, or other literal (not an Error)
    if (expr.type === 'string' || expr.type === 'number' || expr.type === 'template_string'
      || expr.type === 'null' || expr.type === 'undefined' || expr.type === 'true' || expr.type === 'false') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Throw literal',
        `Throwing a literal (${expr.text.slice(0, 30)}) loses the stack trace. Throw an Error object instead.`,
        sourceCode,
        'Replace with `throw new Error(...)` to preserve the stack trace.',
      )
    }
    return null
  },
}

export const noLabelVarVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-label-var',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['labeled_statement'],
  visit(node, filePath, sourceCode) {
    const labelNode = node.children[0]
    if (!labelNode || labelNode.type !== 'statement_identifier') return null
    const labelName = labelNode.text

    // Walk up the scope looking for variable declarations with the same name
    let scope: SyntaxNode | null = node.parent
    while (scope) {
      for (let i = 0; i < scope.namedChildCount; i++) {
        const child = scope.namedChild(i)
        if (child?.type === 'variable_declaration' || child?.type === 'lexical_declaration') {
          for (let j = 0; j < child.namedChildCount; j++) {
            const declarator = child.namedChild(j)
            const name = declarator?.childForFieldName('name')
            if (name?.text === labelName) {
              return makeViolation(
                this.ruleKey, node, filePath, 'medium',
                'Label shadows variable',
                `Label \`${labelName}\` has the same name as a variable in scope.`,
                sourceCode,
                'Rename the label to avoid confusion with the variable.',
              )
            }
          }
        }
      }
      scope = scope.parent
    }
    return null
  },
}

export const noNewWrappersVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-new-wrappers',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['new_expression'],
  visit(node, filePath, sourceCode) {
    const constructor = node.childForFieldName('constructor')
    if (!constructor) return null
    const name = constructor.text
    if (name === 'String' || name === 'Number' || name === 'Boolean') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Primitive wrapper object',
        `\`new ${name}()\` creates a wrapper object, not a primitive. Use \`${name}()\` without \`new\` or use a literal.`,
        sourceCode,
        `Remove \`new\` to call ${name}() as a type conversion, or use a literal.`,
      )
    }
    return null
  },
}

export const noProtoVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-proto',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['member_expression'],
  visit(node, filePath, sourceCode) {
    const prop = node.childForFieldName('property')
    if (prop?.text === '__proto__') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        '__proto__ usage',
        '`__proto__` is deprecated. Use `Object.getPrototypeOf()` or `Object.setPrototypeOf()` instead.',
        sourceCode,
        'Replace __proto__ with Object.getPrototypeOf() or Object.setPrototypeOf().',
      )
    }
    return null
  },
}

export const noVoidVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-void',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['unary_expression'],
  visit(node, filePath, sourceCode) {
    const operator = node.children[0]
    if (operator?.text !== 'void') return null
    // Allow void 0 (common idiom for undefined)
    const operand = node.children[1]
    if (operand?.text === '0') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Void expression',
      'The `void` operator is confusing. Use `undefined` directly or omit the return value.',
      sourceCode,
      'Replace `void expr` with `undefined` or remove the expression.',
    )
  },
}

export const preferConstVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/prefer-const',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['lexical_declaration'],
  visit(node, filePath, sourceCode) {
    // Only check `let` declarations
    if (!node.text.startsWith('let ')) return null

    // Get all declarator names
    const declarators = node.namedChildren.filter((c) => c.type === 'variable_declarator')
    if (declarators.length === 0) return null

    // For each declarator, check if its name is reassigned anywhere in the enclosing scope
    for (const declarator of declarators) {
      const nameNode = declarator.childForFieldName('name')
      if (!nameNode) continue
      const varName = nameNode.text

      // Find the enclosing scope
      let scope = node.parent
      if (!scope) continue

      let isReassigned = false

      function checkReassignment(n: SyntaxNode) {
        if (isReassigned) return
        // assignment_expression: x = ...
        if (n.type === 'assignment_expression' || n.type === 'augmented_assignment_expression') {
          const left = n.childForFieldName('left')
          if (left?.text === varName) {
            isReassigned = true
            return
          }
        }
        // update_expression: x++, x--
        if (n.type === 'update_expression') {
          if (n.text.includes(varName)) {
            isReassigned = true
            return
          }
        }
        // for-in/for-of: for (let x of ...)
        if ((n.type === 'for_in_statement') && n !== node.parent) {
          const left = n.childForFieldName('left')
          if (left?.text?.includes(varName)) {
            isReassigned = true
            return
          }
        }
        for (let i = 0; i < n.childCount; i++) {
          const child = n.child(i)
          if (child) checkReassignment(child)
        }
      }

      checkReassignment(scope)

      if (!isReassigned) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Prefer const',
          `\`let ${varName}\` is never reassigned. Use \`const\` instead for immutability.`,
          sourceCode,
          'Replace `let` with `const`.',
        )
      }
    }
    return null
  },
}

export const noDebuggerVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-debugger',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['debugger_statement'],
  visit(node, filePath, sourceCode) {
    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Debugger statement',
      '`debugger` statement must be removed before deploying to production.',
      sourceCode,
      'Remove the debugger statement.',
    )
  },
}

export const noAlertVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-alert',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'identifier') return null
    if (fn.text === 'alert' || fn.text === 'confirm' || fn.text === 'prompt') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        `${fn.text}() call`,
        `\`${fn.text}()\` blocks the UI thread and should not be used in production. Use a modal dialog or custom UI instead.`,
        sourceCode,
        `Replace ${fn.text}() with a non-blocking modal or custom UI component.`,
      )
    }
    return null
  },
}

export const requireAwaitVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/require-await',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: JS_FUNCTION_TYPES,
  visit(node, filePath, sourceCode) {
    // Check if function is async
    const isAsync = node.children.some((c) => c.type === 'async')
    if (!isAsync) return null

    const bodyNode = getFunctionBody(node)
    if (!bodyNode) return null

    let hasAwait = false

    function walk(n: SyntaxNode) {
      if (hasAwait) return
      if (n.type === 'await_expression') {
        hasAwait = true
        return
      }
      // Don't descend into nested functions
      if (JS_FUNCTION_TYPES.includes(n.type) && n !== node) return
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child)
      }
    }

    walk(bodyNode)

    if (!hasAwait) {
      const name = getFunctionName(node)
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Async without await',
        `Async function \`${name}\` does not use \`await\`. Remove the \`async\` keyword or add an \`await\`.`,
        sourceCode,
        'Remove the `async` keyword if the function does not need to be async.',
      )
    }
    return null
  },
}

export const noReturnAwaitVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-return-await',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['return_statement'],
  visit(node, filePath, sourceCode) {
    const expr = node.namedChildren[0]
    if (!expr || expr.type !== 'await_expression') return null

    // Check if we're inside an async function
    let parent = node.parent
    while (parent) {
      if (JS_FUNCTION_TYPES.includes(parent.type)) {
        const isAsync = parent.children.some((c) => c.type === 'async')
        if (isAsync) {
          // Check it's NOT inside a try block (return await in try is useful)
          let tryParent = node.parent
          while (tryParent && tryParent !== parent) {
            if (tryParent.type === 'try_statement') return null
            tryParent = tryParent.parent
          }

          return makeViolation(
            this.ruleKey, node, filePath, 'low',
            'Redundant return await',
            '`return await` is redundant in an async function. The function already returns a promise.',
            sourceCode,
            'Remove the `await` keyword: `return promise` instead of `return await promise`.',
          )
        }
        break
      }
      parent = parent.parent
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// 25 new rules
// ---------------------------------------------------------------------------

export const expressionComplexityVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/expression-complexity',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['expression_statement', 'return_statement', 'variable_declarator', 'assignment_expression'],
  visit(node, filePath, sourceCode) {
    // Find the expression to examine
    let expr: SyntaxNode | null = null
    if (node.type === 'expression_statement' || node.type === 'return_statement') {
      expr = node.namedChildren[0] ?? null
    } else if (node.type === 'variable_declarator') {
      expr = node.childForFieldName('value')
    } else if (node.type === 'assignment_expression') {
      expr = node.childForFieldName('right')
    }
    if (!expr) return null

    let operatorCount = 0
    const BINARY_TYPES = new Set(['binary_expression', 'logical_expression'])

    function countOps(n: SyntaxNode) {
      if (BINARY_TYPES.has(n.type)) {
        operatorCount++
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) countOps(child)
      }
    }

    countOps(expr)

    if (operatorCount > 5) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Complex expression',
        `Expression has ${operatorCount} binary/logical operators (max 5). Break it into named variables for readability.`,
        sourceCode,
        'Split the expression into smaller, named intermediate variables.',
      )
    }
    return null
  },
}

export const tooManySwitchCasesVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/too-many-switch-cases',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['switch_statement'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    const caseCount = body.namedChildren.filter((c) => c.type === 'switch_case').length
    if (caseCount > 10) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Too many switch cases',
        `Switch has ${caseCount} cases (max 10). Consider using a lookup table or polymorphism.`,
        sourceCode,
        'Replace the switch with an object lookup table or strategy pattern.',
      )
    }
    return null
  },
}

export const tooManyUnionMembersVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/too-many-union-members',
  languages: ['typescript', 'tsx'],
  // Only fire on the top-level union_type (not nested union_type children)
  nodeTypes: ['union_type'],
  visit(node, filePath, sourceCode) {
    // Skip if parent is also a union_type (left-recursive tree — only process outermost)
    if (node.parent?.type === 'union_type') return null

    // Count total leaf members by recursively flattening
    function countMembers(n: SyntaxNode): number {
      if (n.type !== 'union_type') return 1
      let total = 0
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) total += countMembers(child)
      }
      return total
    }

    const memberCount = countMembers(node)
    if (memberCount > 5) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Too many union members',
        `Union type has ${memberCount} members (max 5). Consider using an enum or a type alias for clarity.`,
        sourceCode,
        'Extract the union into a named type alias or use an enum.',
      )
    }
    return null
  },
}

export const tooManyBreaksVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/too-many-breaks',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: JS_FUNCTION_TYPES,
  visit(node, filePath, sourceCode) {
    const bodyNode = getFunctionBody(node)
    if (!bodyNode) return null

    let breakCount = 0

    function walk(n: SyntaxNode) {
      if (JS_FUNCTION_TYPES.includes(n.type) && n !== node) return
      if (n.type === 'break_statement') breakCount++
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child)
      }
    }

    walk(bodyNode)

    if (breakCount > 5) {
      const name = getFunctionName(node)
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Too many break statements',
        `Function \`${name}\` has ${breakCount} break statements (max 5). Consider refactoring the control flow.`,
        sourceCode,
        'Refactor using early returns, helper functions, or lookup tables to reduce break usage.',
      )
    }
    return null
  },
}

export const identicalFunctionsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/identical-functions',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['program'],
  visit(node, filePath, sourceCode) {
    const bodies: Array<{ body: string; fnNode: SyntaxNode }> = []

    function walk(n: SyntaxNode) {
      if (JS_FUNCTION_TYPES.includes(n.type)) {
        const body = getFunctionBody(n)
        if (body && body.namedChildCount > 0) {
          // Normalize whitespace for comparison
          const normalized = body.text.replace(/\s+/g, ' ').trim()
          bodies.push({ body: normalized, fnNode: n })
        }
        // Walk into the function body to catch nested functions
        if (body) {
          for (let i = 0; i < body.childCount; i++) {
            const child = body.child(i)
            if (child) walk(child)
          }
        }
        return
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child)
      }
    }

    walk(node)

    // Find duplicates — report first duplicate pair found
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        if (bodies[i].body === bodies[j].body && bodies[i].body.length > 10) {
          const nameA = getFunctionName(bodies[i].fnNode)
          const nameB = getFunctionName(bodies[j].fnNode)
          return makeViolation(
            this.ruleKey, bodies[i].fnNode, filePath, 'medium',
            'Identical function bodies',
            `Functions \`${nameA}\` and \`${nameB}\` have identical bodies. Extract to a shared function.`,
            sourceCode,
            'Extract the shared logic into a helper function and call it from both places.',
          )
        }
      }
    }
    return null
  },
}

export const unusedVariableVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unused-variable',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: JS_FUNCTION_TYPES,
  visit(node, filePath, sourceCode) {
    const bodyNode = getFunctionBody(node)
    if (!bodyNode) return null

    // Collect all local variable declarations in this function (not nested)
    const declared = new Map<string, SyntaxNode>()
    const read = new Set<string>()

    function collectDeclarations(n: SyntaxNode) {
      if (JS_FUNCTION_TYPES.includes(n.type) && n !== node) return
      if ((n.type === 'variable_declaration' || n.type === 'lexical_declaration')) {
        for (const declarator of n.namedChildren) {
          if (declarator.type === 'variable_declarator') {
            const nameNode = declarator.childForFieldName('name')
            if (nameNode && nameNode.type === 'identifier') {
              declared.set(nameNode.text, nameNode)
            }
          }
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) collectDeclarations(child)
      }
    }

    function collectReads(n: SyntaxNode) {
      if (JS_FUNCTION_TYPES.includes(n.type) && n !== node) {
        // For nested functions, mark everything they reference as read
        collectReadsUnscoped(n)
        return
      }
      if (n.type === 'identifier') {
        // Check if this identifier is being read (not declared, not assigned-to)
        const parent = n.parent
        if (parent) {
          // Skip: left side of assignment
          if ((parent.type === 'assignment_expression' || parent.type === 'augmented_assignment_expression')
            && parent.childForFieldName('left') === n) return
          // Skip: variable_declarator name
          if (parent.type === 'variable_declarator' && parent.childForFieldName('name') === n) return
          // Skip: for-in/for-of left side
          if (parent.type === 'for_in_statement' && parent.childForFieldName('left') === n) return
          // Skip: update expression (i++ counts as write AND read — we'll say it's a read)
        }
        read.add(n.text)
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) collectReads(child)
      }
    }

    function collectReadsUnscoped(n: SyntaxNode) {
      if (n.type === 'identifier') read.add(n.text)
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) collectReadsUnscoped(child)
      }
    }

    collectDeclarations(bodyNode)
    collectReads(bodyNode)

    for (const [name, nameNode] of declared) {
      if (!read.has(name) && !name.startsWith('_')) {
        return makeViolation(
          this.ruleKey, nameNode, filePath, 'medium',
          'Unused variable',
          `Variable \`${name}\` is declared but never read. Remove it or prefix with _ to mark as intentionally unused.`,
          sourceCode,
          'Remove the unused variable or prefix its name with _ to acknowledge it is intentionally unused.',
        )
      }
    }
    return null
  },
}

export const unusedPrivateMemberVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unused-private-member',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['class_declaration', 'class'],
  visit(node, filePath, sourceCode) {
    // tree-sitter uses 'class_body' as child type name
    const body = node.namedChildren.find((c) => c.type === 'class_body')
    if (!body) return null

    // Collect private members — tree-sitter uses 'public_field_definition' for field declarations
    const privateMembers = new Map<string, SyntaxNode>()
    for (const member of body.namedChildren) {
      if (member.type === 'method_definition' || member.type === 'field_definition'
        || member.type === 'public_field_definition') {
        const isPrivate = member.children.some((c) => c.type === 'accessibility_modifier' && c.text === 'private')
          || member.children.some((c) => c.type === 'private_property_identifier')
        if (!isPrivate) continue
        // Name node may be property_identifier or private_property_identifier
        const nameNode = member.children.find((c) => c.type === 'property_identifier' || c.type === 'private_property_identifier')
        if (nameNode) {
          const name = nameNode.text.replace(/^#/, '')
          privateMembers.set(name, nameNode)
        }
      }
    }

    if (privateMembers.size === 0) return null

    // Check usages throughout the class body
    const usedNames = new Set<string>()

    function walk(n: SyntaxNode) {
      if (n.type === 'member_expression') {
        const obj = n.childForFieldName('object')
        const prop = n.childForFieldName('property')
        if (obj?.text === 'this' && prop) {
          usedNames.add(prop.text.replace(/^#/, ''))
        }
      }
      if (n.type === 'private_property_identifier') {
        usedNames.add(n.text.replace(/^#/, ''))
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child)
      }
    }

    walk(body)

    for (const [name, nameNode] of privateMembers) {
      // The declaration itself uses the name, so >0 refs needed
      if (!usedNames.has(name)) {
        return makeViolation(
          this.ruleKey, nameNode, filePath, 'medium',
          'Unused private member',
          `Private member \`${name}\` is never accessed. Remove it or make it used.`,
          sourceCode,
          'Remove the unused private member or access it somewhere in the class.',
        )
      }
    }
    return null
  },
}

export const deadStoreVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/dead-store',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: JS_FUNCTION_TYPES,
  visit(node, filePath, sourceCode) {
    const ruleKey = this.ruleKey
    const bodyNode = getFunctionBody(node)
    if (!bodyNode) return null

    // Track the last write-node per variable (and whether it was read since)
    const lastAssign = new Map<string, { assignNode: SyntaxNode; hasBeenRead: boolean }>()

    function markRead(name: string) {
      const entry = lastAssign.get(name)
      if (entry) entry.hasBeenRead = true
    }

    function markReadsInExpr(n: SyntaxNode) {
      if (n.type === 'identifier') markRead(n.text)
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) markReadsInExpr(child)
      }
    }

    function processStmts(stmts: SyntaxNode[]): import('@truecourse/shared').CodeViolation | null {
      for (const stmt of stmts) {
        // Track initial declarations: let x = <expr>
        if (stmt.type === 'lexical_declaration' || stmt.type === 'variable_declaration') {
          for (const decl of stmt.namedChildren) {
            if (decl.type === 'variable_declarator') {
              const nameNode = decl.childForFieldName('name')
              const value = decl.childForFieldName('value')
              if (nameNode?.type === 'identifier') {
                // Mark reads in the RHS first
                if (value) markReadsInExpr(value)
                lastAssign.set(nameNode.text, { assignNode: decl, hasBeenRead: false })
              }
            }
          }
          continue
        }

        // Track simple re-assignments: x = <expr>
        if (stmt.type === 'expression_statement') {
          const expr = stmt.namedChildren[0]
          if (expr?.type === 'assignment_expression') {
            const left = expr.childForFieldName('left')
            const right = expr.childForFieldName('right')
            const opNode = expr.children.find((c) => c.type === '=')
            if (left?.type === 'identifier' && opNode && right) {
              const varName = left.text
              const existing = lastAssign.get(varName)
              // Mark reads in the RHS before checking dead store
              markReadsInExpr(right)
              if (existing && !existing.hasBeenRead) {
                return makeViolation(
                  ruleKey, existing.assignNode, filePath, 'medium',
                  'Dead store',
                  `Value assigned to \`${varName}\` is overwritten before being read.`,
                  sourceCode,
                  'Remove the dead assignment or use the value before overwriting it.',
                )
              }
              lastAssign.set(varName, { assignNode: expr, hasBeenRead: false })
              continue
            }
          }
        }

        // For all other statements, mark any identifier as read
        markReadsInExpr(stmt)
      }
      return null
    }

    return processStmts(bodyNode.namedChildren)
  },
}

export const unusedCollectionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unused-collection',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: JS_FUNCTION_TYPES,
  visit(node, filePath, sourceCode) {
    const bodyNode = getFunctionBody(node)
    if (!bodyNode) return null

    // Find variables initialized to [], new Set(), new Map()
    const collections = new Map<string, SyntaxNode>()

    function isCollectionInit(n: SyntaxNode): boolean {
      if (n.type === 'array') return true
      if (n.type === 'new_expression') {
        const ctor = n.childForFieldName('constructor')
        if (ctor?.text === 'Set' || ctor?.text === 'Map' || ctor?.text === 'Array') return true
      }
      return false
    }

    function collectDecls(n: SyntaxNode) {
      if (JS_FUNCTION_TYPES.includes(n.type) && n !== node) return
      if (n.type === 'variable_declaration' || n.type === 'lexical_declaration') {
        for (const decl of n.namedChildren) {
          if (decl.type === 'variable_declarator') {
            const nameNode = decl.childForFieldName('name')
            const value = decl.childForFieldName('value')
            if (nameNode?.type === 'identifier' && value && isCollectionInit(value)) {
              collections.set(nameNode.text, nameNode)
            }
          }
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) collectDecls(child)
      }
    }

    const reads = new Set<string>()
    function collectReads(n: SyntaxNode) {
      if (JS_FUNCTION_TYPES.includes(n.type) && n !== node) {
        // Mark all identifiers in nested functions as read
        function markAll(m: SyntaxNode) {
          if (m.type === 'identifier') reads.add(m.text)
          for (let i = 0; i < m.childCount; i++) {
            const c = m.child(i)
            if (c) markAll(c)
          }
        }
        markAll(n)
        return
      }
      if (n.type === 'identifier') {
        const parent = n.parent
        if (parent) {
          if ((parent.type === 'variable_declarator') && parent.childForFieldName('name') === n) {
            // declaration — not a read
          } else if ((parent.type === 'assignment_expression') && parent.childForFieldName('left') === n) {
            // Pure assignment left side (x = something) — check for member calls like x.push
          } else {
            reads.add(n.text)
          }
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) collectReads(child)
      }
    }

    collectDecls(bodyNode)
    collectReads(bodyNode)

    for (const [name, nameNode] of collections) {
      if (!reads.has(name) && !name.startsWith('_')) {
        return makeViolation(
          this.ruleKey, nameNode, filePath, 'medium',
          'Unused collection',
          `Collection \`${name}\` is created but never read. Remove it or use it.`,
          sourceCode,
          'Remove the unused collection or use its contents somewhere.',
        )
      }
    }
    return null
  },
}

export const redundantAssignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/redundant-assignment',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['assignment_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (!left || !right) return null

    // Self-assignment: x = x
    if (left.type === 'identifier' && right.type === 'identifier' && left.text === right.text) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Redundant self-assignment',
        `\`${left.text} = ${right.text}\` assigns a variable to itself — this has no effect.`,
        sourceCode,
        'Remove the self-assignment.',
      )
    }

    return null
  },
}

export const noLonelyIfVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-lonely-if',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['else_clause'],
  visit(node, filePath, sourceCode) {
    const body = node.namedChildren[0]
    if (!body || body.type !== 'statement_block') return null

    const stmts = body.namedChildren
    if (stmts.length !== 1 || stmts[0].type !== 'if_statement') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Lonely if in else block',
      '`if` is the only statement inside `else {}`. Use `else if` instead.',
      sourceCode,
      'Replace `else { if (...) }` with `else if (...)`.',
    )
  },
}

export const uselessConstructorVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/useless-constructor',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['method_definition'],
  visit(node, filePath, sourceCode) {
    const nameNode = node.childForFieldName('name')
    if (nameNode?.text !== 'constructor') return null

    const body = node.namedChildren.find((c) => c.type === 'statement_block')
    if (!body) return null

    const stmts = body.namedChildren
    if (stmts.length !== 1) return null

    const stmt = stmts[0]
    if (stmt.type !== 'expression_statement') return null

    const expr = stmt.namedChildren[0]
    if (!expr || expr.type !== 'call_expression') return null

    const fn = expr.childForFieldName('function')
    if (!fn) return null

    // Check for super(...)
    if (fn.type !== 'super') return null

    // Check that arguments are only identifiers matching constructor params (same args forwarded)
    const params = node.childForFieldName('parameters')
    const args = expr.childForFieldName('arguments')

    if (!params || !args) return null

    const paramTexts = params.namedChildren.map((p) => {
      const n = p.childForFieldName('pattern') ?? p
      return n.text
    })
    const argTexts = args.namedChildren.map((a) => a.text)

    if (JSON.stringify(paramTexts) === JSON.stringify(argTexts)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Useless constructor',
        'This constructor only calls `super()` with the same arguments — it can be removed.',
        sourceCode,
        'Remove the constructor — the parent class constructor will be called automatically.',
      )
    }
    return null
  },
}

export const uselessEscapeVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/useless-escape',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['string'],
  visit(node, filePath, sourceCode) {
    const text = node.text
    // Determine quote character
    const quoteChar = text[0]
    if (quoteChar !== '"' && quoteChar !== "'") return null

    // Characters that are valid to escape in strings
    const validEscapes = new Set(['n', 'r', 't', 'b', 'f', 'v', '0', '\\', quoteChar, 'u', 'x', '\n'])

    let i = 1 // skip opening quote
    while (i < text.length - 1) {
      if (text[i] === '\\' && i + 1 < text.length - 1) {
        const next = text[i + 1]
        if (!validEscapes.has(next) && next !== '\r') {
          return makeViolation(
            this.ruleKey, node, filePath, 'low',
            'Unnecessary escape character',
            `Unnecessary escape \`\\${next}\` in string — the backslash has no effect here.`,
            sourceCode,
            `Remove the backslash: use \`${next}\` instead of \`\\${next}\`.`,
          )
        }
        i += 2
      } else {
        i++
      }
    }
    return null
  },
}

export const uselessRenameVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/useless-rename',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['object_pattern', 'object'],
  visit(node, filePath, sourceCode) {
    // For destructuring: { x: x } — object_pattern contains pair_pattern where key === value
    if (node.type === 'object_pattern') {
      for (const child of node.namedChildren) {
        if (child.type === 'pair_pattern') {
          const key = child.childForFieldName('key')
          const value = child.childForFieldName('value')
          if (key?.type === 'property_identifier' && value?.type === 'identifier'
            && key.text === value.text) {
            return makeViolation(
              this.ruleKey, child, filePath, 'low',
              'Useless destructuring rename',
              `\`{ ${key.text}: ${value.text} }\` renames to the same name — use \`{ ${key.text} }\` instead.`,
              sourceCode,
              `Replace \`{ ${key.text}: ${key.text} }\` with \`{ ${key.text} }\`.`,
            )
          }
        }
      }
    }
    return null
  },
}

export const uselessComputedKeyVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/useless-computed-key',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['pair'],
  visit(node, filePath, sourceCode) {
    const key = node.childForFieldName('key')
    if (!key) return null

    // Computed key is wrapped in computed_property_name
    if (key.type !== 'computed_property_name') return null

    const inner = key.namedChildren[0]
    if (!inner) return null

    // If the inner expression is a string literal, it's useless
    if (inner.type === 'string') {
      const strVal = inner.text.slice(1, -1) // strip quotes
      // If it's a valid identifier, flag it
      if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(strVal)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Useless computed property key',
          `\`[${inner.text}]\` is a computed key with a string literal — use \`${strVal}\` directly.`,
          sourceCode,
          `Replace \`[${inner.text}]\` with \`${strVal}\`.`,
        )
      }
    }
    return null
  },
}

export const uselessConcatVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/useless-concat',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const op = node.children.find((c) => c.type === '+')
    if (!op) return null

    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')

    if (left?.type === 'string' && right?.type === 'string') {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Useless string concatenation',
        `Concatenating two string literals ${left.text} + ${right.text} — merge them into one string.`,
        sourceCode,
        'Combine the string literals into a single string.',
      )
    }
    return null
  },
}

export const strictEqualityVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/strict-equality',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const op = node.children.find((c) => c.type === '==' || c.type === '!=')
    if (!op) return null

    const opText = op.text
    const strict = opText === '==' ? '===' : '!=='

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Loose equality operator',
      `Using \`${opText}\` performs type coercion. Use \`${strict}\` for predictable comparisons.`,
      sourceCode,
      `Replace \`${opText}\` with \`${strict}\`.`,
    )
  },
}

export const commentedOutCodeVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/commented-out-code',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['comment'],
  visit(node, filePath, sourceCode) {
    const text = node.text

    // Skip JSDoc/documentation comments
    if (text.startsWith('/**')) return null

    // Extract the inner content
    let inner = text
    if (inner.startsWith('//')) inner = inner.slice(2).trim()
    else if (inner.startsWith('/*')) inner = inner.slice(2, -2).trim()

    if (inner.length < 10) return null

    // Heuristics: lines that look like code
    const codePatterns = [
      /^\s*(const|let|var|function|return|if|for|while|import|export|class|throw|try|catch)\s/,
      /[;{}()]\s*$/,
      /=>/,
      /\w+\s*\(.*\)\s*[;{]?\s*$/,
    ]

    const matchCount = codePatterns.filter((p) => p.test(inner)).length
    if (matchCount >= 2) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Commented-out code',
        'This comment appears to contain commented-out code. Remove it or track it in version control.',
        sourceCode,
        'Delete the commented-out code. If needed, it can be recovered from version control.',
      )
    }
    return null
  },
}

export const invertedBooleanVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/inverted-boolean',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['unary_expression'],
  visit(node, filePath, sourceCode) {
    const op = node.children[0]
    if (op?.text !== '!') return null

    const operand = node.namedChildren[0]
    if (!operand) return null

    // Pattern: !!x
    if (operand.type === 'unary_expression') {
      const innerOp = operand.children[0]
      if (innerOp?.text === '!') {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Double negation',
          '`!!x` converts to boolean but can be replaced with `Boolean(x)` for clarity.',
          sourceCode,
          'Replace `!!x` with `Boolean(x)` or use a direct boolean check.',
        )
      }
    }

    // Pattern: !(x) where x is already unary negation — !(!x)
    if (operand.type === 'parenthesized_expression') {
      const inner = operand.namedChildren[0]
      if (inner?.type === 'unary_expression' && inner.children[0]?.text === '!') {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Double negation',
          '`!(!x)` is equivalent to `!!x` — use the original value directly or `Boolean(x)`.',
          sourceCode,
          'Remove the double negation and use the value directly.',
        )
      }
    }
    return null
  },
}

export const preferSingleBooleanReturnVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/prefer-single-boolean-return',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: JS_FUNCTION_TYPES,
  visit(node, filePath, sourceCode) {
    const bodyNode = getFunctionBody(node)
    if (!bodyNode) return null

    // Find if the body has ONLY if statements that each return true or false
    const stmts = bodyNode.namedChildren
    if (stmts.length < 2) return null

    let allBooleanReturns = true
    let hasAtLeastOneBoolReturn = false

    for (const stmt of stmts) {
      if (stmt.type === 'return_statement') {
        const val = stmt.namedChildren[0]
        if (val && (val.text === 'true' || val.text === 'false')) {
          hasAtLeastOneBoolReturn = true
        } else {
          allBooleanReturns = false
          break
        }
      } else if (stmt.type === 'if_statement') {
        function checkIfReturnsBoolean(n: SyntaxNode): boolean {
          const consequence = n.childForFieldName('consequence')
          if (!consequence) return false
          function getReturn(block: SyntaxNode): string | null {
            if (block.type === 'return_statement') {
              const val = block.namedChildren[0]
              return val?.text ?? null
            }
            if (block.type === 'statement_block') {
              const s = block.namedChildren
              if (s.length === 1) return getReturn(s[0])
            }
            return null
          }
          const retVal = getReturn(consequence)
          if (retVal !== 'true' && retVal !== 'false') return false
          hasAtLeastOneBoolReturn = true
          return true
        }
        if (!checkIfReturnsBoolean(stmt)) {
          allBooleanReturns = false
          break
        }
      } else {
        allBooleanReturns = false
        break
      }
    }

    if (allBooleanReturns && hasAtLeastOneBoolReturn && stmts.length >= 2) {
      const name = getFunctionName(node)
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Prefer single boolean return',
        `Function \`${name}\` returns true/false in multiple branches — use a single boolean expression.`,
        sourceCode,
        'Replace multiple boolean returns with a single `return <condition>` expression.',
      )
    }
    return null
  },
}

export const preferImmediateReturnVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/prefer-immediate-return',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: JS_FUNCTION_TYPES,
  visit(node, filePath, sourceCode) {
    const bodyNode = getFunctionBody(node)
    if (!bodyNode) return null

    const stmts = bodyNode.namedChildren
    if (stmts.length < 2) return null

    const last = stmts[stmts.length - 1]
    const secondLast = stmts[stmts.length - 2]

    // Last statement must be: return <identifier>
    if (last.type !== 'return_statement') return null
    const retVal = last.namedChildren[0]
    if (!retVal || retVal.type !== 'identifier') return null
    const retName = retVal.text

    // Second-to-last must be: const/let retName = <expr>
    if (secondLast.type !== 'variable_declaration' && secondLast.type !== 'lexical_declaration') return null
    const declarators = secondLast.namedChildren.filter((c) => c.type === 'variable_declarator')
    if (declarators.length !== 1) return null
    const decl = declarators[0]
    const nameNode = decl.childForFieldName('name')
    if (nameNode?.text !== retName) return null

    // Make sure the variable is not used elsewhere in the function
    let usageCount = 0
    function countUsages(n: SyntaxNode) {
      if (n.type === 'identifier' && n.text === retName) {
        const parent = n.parent
        if (parent?.type === 'variable_declarator' && parent.childForFieldName('name') === n) return
        usageCount++
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) countUsages(child)
      }
    }
    countUsages(bodyNode)

    if (usageCount === 1) {
      return makeViolation(
        this.ruleKey, secondLast, filePath, 'low',
        'Prefer immediate return',
        `Variable \`${retName}\` is assigned and immediately returned — return the expression directly.`,
        sourceCode,
        `Replace \`const ${retName} = expr; return ${retName};\` with \`return expr;\`.`,
      )
    }
    return null
  },
}

export const preferWhileVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/prefer-while',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['for_statement'],
  visit(node, filePath, sourceCode) {
    const initializer = node.childForFieldName('initializer')
    const condition = node.childForFieldName('condition')
    const increment = node.childForFieldName('increment')

    // for(;condition;) — initializer is empty_statement (;), condition exists, no increment
    const initIsEmpty = !initializer || initializer.type === 'empty_statement'
    if (initIsEmpty && condition && !increment) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Prefer while loop',
        '`for(;condition;)` with no initializer or increment is clearer as `while(condition)`.',
        sourceCode,
        'Replace `for(;condition;) { ... }` with `while(condition) { ... }`.',
      )
    }
    return null
  },
}

export const preferObjectSpreadVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/prefer-object-spread',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const obj = fn.childForFieldName('object')
    const prop = fn.childForFieldName('property')
    if (obj?.text !== 'Object' || prop?.text !== 'assign') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const argList = args.namedChildren
    if (argList.length < 1) return null

    // First arg should be an empty object literal {}
    const firstArg = argList[0]
    if (firstArg.type !== 'object' || firstArg.namedChildCount !== 0) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Prefer object spread',
      '`Object.assign({}, ...)` can be replaced with `{ ...obj }` object spread syntax.',
      sourceCode,
      'Replace `Object.assign({}, obj)` with `{ ...obj }`.',
    )
  },
}

export const preferOptionalChainVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/prefer-optional-chain',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['logical_expression', 'binary_expression'],
  visit(node, filePath, sourceCode) {
    // Pattern: a && a.b  or  a && a.b && a.b.c
    const op = node.children.find((c) => c.type === '&&')
    if (!op) return null

    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (!left || !right) return null

    // left should be a simple identifier, right should be a member_expression starting with that identifier
    if (left.type === 'identifier') {
      if (right.type === 'member_expression') {
        const rightObj = right.childForFieldName('object')
        if (rightObj?.text === left.text) {
          // Don't fire if parent is also a && expression (let the outermost handle it)
          const parent = node.parent
          if (parent?.type === 'logical_expression' || parent?.type === 'binary_expression') {
            const parentOp = parent.children.find((c) => c.type === '&&')
            if (parentOp) return null
          }
          return makeViolation(
            this.ruleKey, node, filePath, 'low',
            'Prefer optional chaining',
            `\`${left.text} && ${right.text}\` can be simplified to \`${left.text}?.${right.childForFieldName('property')?.text}\`.`,
            sourceCode,
            'Use optional chaining (?.) instead of the && guard.',
          )
        }
      }
    }
    return null
  },
}

export const preferNullishCoalescingVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/prefer-nullish-coalescing',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['ternary_expression'],
  visit(node, filePath, sourceCode) {
    // Pattern: a !== null && a !== undefined ? a : b
    // or simpler: a != null ? a : b
    const condition = node.childForFieldName('condition')
    const consequence = node.childForFieldName('consequence')

    if (!condition || !consequence) return null

    function getCheckedVar(cond: SyntaxNode): string | null {
      // a != null  (covers both null and undefined due to loose equality)
      if (cond.type === 'binary_expression') {
        const op = cond.children.find((c) => c.type === '!=' || c.type === '!==')
        if (op) {
          const left = cond.childForFieldName('left')
          const right = cond.childForFieldName('right')
          if (left?.type === 'identifier' && (right?.text === 'null' || right?.text === 'undefined')) {
            return left.text
          }
        }
      }
      // a !== null && a !== undefined
      if (cond.type === 'logical_expression' || cond.type === 'binary_expression') {
        const logOp = cond.children.find((c) => c.type === '&&')
        if (logOp) {
          const l = cond.childForFieldName('left')
          const r = cond.childForFieldName('right')
          if (l && r) {
            const lVar = getCheckedVar(l)
            const rVar = getCheckedVar(r)
            if (lVar && lVar === rVar) return lVar
          }
        }
      }
      return null
    }

    const checkedVar = getCheckedVar(condition)
    if (!checkedVar) return null

    // consequence should be the same variable
    if (consequence.type === 'identifier' && consequence.text === checkedVar) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Prefer nullish coalescing',
        `\`${condition.text} ? ${consequence.text} : ...\` can be simplified to \`${checkedVar} ?? ...\`.`,
        sourceCode,
        `Replace with \`${checkedVar} ?? <default>\`.`,
      )
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// Batch 3 — 25 new rules
// ---------------------------------------------------------------------------

export const preferRestParamsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/prefer-rest-params',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['identifier'],
  visit(node, filePath, sourceCode) {
    if (node.text !== 'arguments') return null
    // Must be inside a function body (not an arrow function, which doesn't have arguments)
    let parent = node.parent
    while (parent) {
      if (parent.type === 'arrow_function') return null // arrow functions don't bind arguments
      if (parent.type === 'function_declaration' || parent.type === 'function_expression' || parent.type === 'method_definition') {
        // Check this isn't in a property definition context (like arguments.length as part of a name)
        const nodeParent = node.parent
        if (nodeParent?.type === 'member_expression' && nodeParent.childForFieldName('object') === node) {
          // arguments.xxx — definitely the arguments object
        } else if (nodeParent?.type === 'call_expression' && nodeParent.childForFieldName('function') === node) {
          // arguments() — shouldn't happen but skip
          return null
        }
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Arguments object usage',
          '`arguments` object is error-prone and cannot be used in arrow functions. Use rest parameters `...args` instead.',
          sourceCode,
          'Replace `arguments` with a rest parameter: `function fn(...args) { ... }`.',
        )
      }
      parent = parent.parent
    }
    return null
  },
}

export const preferSpreadVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/prefer-spread',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const prop = fn.childForFieldName('property')
    if (prop?.text !== 'apply') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const argList = args.namedChildren
    // fn.apply(context, argsArray) — 2 args
    if (argList.length === 2) {
      const contextArg = argList[0]
      // If context is null or the same object, spread is cleaner
      if (contextArg.text === 'null' || contextArg.text === 'undefined' || contextArg.text === 'this') {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Prefer spread over apply',
          '`fn.apply(ctx, args)` can be replaced with `fn(...args)` using the spread operator.',
          sourceCode,
          'Replace `.apply(ctx, args)` with `fn(...args)` or `fn.call(ctx, ...args)`.',
        )
      }
    }
    return null
  },
}

export const parameterReassignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/parameter-reassignment',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: JS_FUNCTION_TYPES,
  visit(node, filePath, sourceCode) {
    const params = node.childForFieldName('parameters')
    if (!params) return null

    // Collect parameter names
    const paramNames = new Set<string>()
    function collectParamNames(n: SyntaxNode) {
      if (n.type === 'identifier') {
        paramNames.add(n.text)
        return
      }
      // patterns: assignment_pattern, rest_pattern, object_pattern, array_pattern
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) collectParamNames(child)
      }
    }
    for (let i = 0; i < params.namedChildCount; i++) {
      const p = params.namedChild(i)
      if (p) {
        if (p.type === 'identifier') paramNames.add(p.text)
        else if (p.type === 'required_parameter' || p.type === 'optional_parameter') {
          // TypeScript parameter nodes
          const nameNode = p.childForFieldName('pattern') ?? p.namedChildren[0]
          if (nameNode?.type === 'identifier') paramNames.add(nameNode.text)
        } else if (p.type === 'assignment_pattern') {
          const left = p.childForFieldName('left')
          if (left?.type === 'identifier') paramNames.add(left.text)
        } else if (p.type === 'rest_pattern') {
          const inner = p.namedChildren[0]
          if (inner?.type === 'identifier') paramNames.add(inner.text)
        }
      }
    }

    if (paramNames.size === 0) return null

    const bodyNode = getFunctionBody(node)
    if (!bodyNode) return null

    // Look for assignments to param names
    function findReassignment(n: SyntaxNode): SyntaxNode | null {
      // Don't descend into nested functions
      if (JS_FUNCTION_TYPES.includes(n.type) && n !== node) return null

      if (n.type === 'assignment_expression' || n.type === 'augmented_assignment_expression') {
        const left = n.childForFieldName('left')
        if (left?.type === 'identifier' && paramNames.has(left.text)) {
          return left
        }
      }
      if (n.type === 'update_expression') {
        // i++ or ++i — find the identifier
        for (let i = 0; i < n.namedChildCount; i++) {
          const child = n.namedChild(i)
          if (child?.type === 'identifier' && paramNames.has(child.text)) return child
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) {
          const result = findReassignment(child)
          if (result) return result
        }
      }
      return null
    }

    const reassigned = findReassignment(bodyNode)
    if (reassigned) {
      return makeViolation(
        this.ruleKey, reassigned, filePath, 'medium',
        'Parameter reassignment',
        `Parameter \`${reassigned.text}\` is reassigned. Use a local variable instead to keep function parameters immutable.`,
        sourceCode,
        `Introduce a local variable: \`let local = ${reassigned.text};\` and modify that instead.`,
      )
    }
    return null
  },
}

export const labelsUsageVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/labels-usage',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['labeled_statement'],
  visit(node, filePath, sourceCode) {
    const labelNode = node.children[0]
    const labelName = labelNode?.text ?? 'label'
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Labeled statement',
      `Label \`${labelName}\` makes control flow hard to follow. Refactor using helper functions or early returns.`,
      sourceCode,
      'Refactor to remove the label — use functions or break/continue without labels.',
    )
  },
}

export const extendNativeVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/extend-native',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['assignment_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    if (!left || left.type !== 'member_expression') return null

    const obj = left.childForFieldName('object')
    const prop = left.childForFieldName('property')
    if (!obj || !prop) return null

    // Pattern: BuiltIn.prototype.something = ...
    if (obj.type !== 'member_expression') return null
    const builtinName = obj.childForFieldName('object')
    const prototypeProp = obj.childForFieldName('property')

    if (prototypeProp?.text !== 'prototype') return null

    const BUILTINS = new Set(['Array', 'Object', 'String', 'Number', 'Boolean', 'Function',
      'RegExp', 'Date', 'Error', 'Map', 'Set', 'Promise', 'Symbol', 'Math', 'JSON'])

    if (builtinName?.type === 'identifier' && BUILTINS.has(builtinName.text)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Extending native type',
        `Modifying \`${builtinName.text}.prototype\` is dangerous — it can conflict with libraries and future language features.`,
        sourceCode,
        'Use a utility function or subclass instead of modifying the native prototype.',
      )
    }
    return null
  },
}

export const arrayConstructorVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/array-constructor',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['new_expression'],
  visit(node, filePath, sourceCode) {
    const ctor = node.childForFieldName('constructor')
    if (ctor?.text !== 'Array') return null

    const args = node.childForFieldName('arguments')
    const argList = args?.namedChildren ?? []

    // new Array() with 0 args → use []
    // new Array(x, y) with multiple args → use [x, y]
    // new Array(n) with one number arg is arguably OK (pre-allocation) but still flagged by eslint
    if (argList.length !== 1) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Array constructor',
        '`new Array(...)` is ambiguous. Use array literal syntax `[...]` instead.',
        sourceCode,
        'Replace `new Array(...)` with `[...]`.',
      )
    }
    return null
  },
}

export const functionInLoopVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/function-in-loop',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['function_declaration', 'function_expression', 'arrow_function'],
  visit(node, filePath, sourceCode) {
    const LOOP_TYPES = new Set(['for_statement', 'for_in_statement', 'while_statement', 'do_statement'])
    let parent = node.parent
    while (parent) {
      if (LOOP_TYPES.has(parent.type)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Function defined in loop',
          'Function defined inside a loop captures loop variables by reference, which can cause subtle bugs.',
          sourceCode,
          'Move the function outside the loop, or use block-scoped `let` and closures carefully.',
        )
      }
      // Stop at enclosing function boundary
      if (JS_FUNCTION_TYPES.includes(parent.type) && parent !== node) break
      parent = parent.parent
    }
    return null
  },
}

export const multiAssignVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/multi-assign',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['assignment_expression'],
  visit(node, filePath, sourceCode) {
    // Chained assignment: a = b = c — the right side is also an assignment_expression
    const right = node.childForFieldName('right')
    if (right?.type === 'assignment_expression') {
      // Only flag the outermost (don't fire if parent is also assignment_expression)
      const parent = node.parent
      if (parent?.type === 'assignment_expression') return null

      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Chained assignment',
        'Chained assignments like `a = b = c` are hard to read. Use separate assignment statements.',
        sourceCode,
        'Split into separate assignment statements.',
      )
    }
    return null
  },
}

export const bitwiseInBooleanVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/bitwise-in-boolean',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const op = node.children.find((c) => c.type === '&' || c.type === '|')
    if (!op) return null

    // Walk up through parenthesized_expression wrappers to find the boolean context
    const BOOL_CONTEXT_TYPES = new Set(['if_statement', 'while_statement', 'for_statement', 'do_statement', 'ternary_expression'])
    let current: SyntaxNode | null = node
    let parent: SyntaxNode | null = node.parent

    // Unwrap through parenthesized_expression layers
    while (parent?.type === 'parenthesized_expression') {
      current = parent
      parent = parent.parent
    }

    if (!parent) return null

    // Check if we're in a condition slot
    const isBoolContext = BOOL_CONTEXT_TYPES.has(parent.type)
      && parent.childForFieldName('condition') === current

    if (!isBoolContext) return null

    const intended = op.type === '&' ? '&&' : '||'
    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Bitwise operator in boolean context',
      `Bitwise \`${op.type}\` used in a boolean context — did you mean logical \`${intended}\`?`,
      sourceCode,
      `Replace \`${op.type}\` with \`${intended}\` if a logical operator was intended.`,
    )
  },
}

export const forInWithoutFilterVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/for-in-without-filter',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['for_in_statement'],
  visit(node, filePath, sourceCode) {
    // Only flag for...in (not for...of which is the 'of' keyword)
    const hasOf = node.children.some((c) => c.type === 'of')
    if (hasOf) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    // Check if the body contains a hasOwnProperty call
    function hasOwnPropertyCheck(n: SyntaxNode): boolean {
      if (n.type === 'call_expression') {
        const fn = n.childForFieldName('function')
        if (fn?.type === 'member_expression') {
          const prop = fn.childForFieldName('property')
          if (prop?.text === 'hasOwnProperty' || prop?.text === 'hasOwn') return true
        }
      }
      // Also accept Object.prototype.hasOwnProperty.call(...)
      if (n.type === 'string' && (n.text.includes('hasOwnProperty') || n.text.includes('hasOwn'))) return true
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child && hasOwnPropertyCheck(child)) return true
      }
      return false
    }

    if (!hasOwnPropertyCheck(body)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'for-in without hasOwnProperty check',
        '`for...in` iterates inherited properties. Add an `Object.hasOwn(obj, key)` check inside the loop.',
        sourceCode,
        'Add `if (!Object.hasOwn(obj, key)) continue;` at the start of the loop body, or use `for...of Object.keys(obj)` instead.',
      )
    }
    return null
  },
}

export const withStatementVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/with-statement',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['with_statement'],
  visit(node, filePath, sourceCode) {
    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'with statement',
      '`with` statement is confusing, deprecated in strict mode, and disallowed in TypeScript. Remove it.',
      sourceCode,
      'Replace `with (obj) { ... }` by assigning `obj` to a variable and accessing its properties explicitly.',
    )
  },
}

export const defaultCaseLastVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/default-case-last',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['switch_statement'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    const cases = body.namedChildren
    if (cases.length === 0) return null

    // Find the default case
    let defaultIndex = -1
    for (let i = 0; i < cases.length; i++) {
      if (cases[i].type === 'switch_default') {
        defaultIndex = i
        break
      }
    }

    if (defaultIndex === -1) return null // no default case
    if (defaultIndex === cases.length - 1) return null // default is already last

    return makeViolation(
      this.ruleKey, cases[defaultIndex], filePath, 'low',
      'Default case not last',
      'The `default` clause should be the last case in a `switch` statement for readability.',
      sourceCode,
      'Move the `default` clause to the end of the switch statement.',
    )
  },
}

export const elseifWithoutElseVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/elseif-without-else',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    // Only flag top-level if statements (not the inner if of an else-if chain)
    const parent = node.parent
    if (parent?.type === 'else_clause') return null // this is the inner if of an else-if

    // Must have at least one else-if clause (i.e., else body is an if_statement)
    let hasElseIf = false
    let hasElse = false

    let currentNode: SyntaxNode | null = node
    while (currentNode?.type === 'if_statement') {
      const elseClause: import('tree-sitter').SyntaxNode | undefined = currentNode.children.find((c) => c.type === 'else_clause')
      if (!elseClause) break

      const elseBody: import('tree-sitter').SyntaxNode | undefined = elseClause.namedChildren[0]
      if (!elseBody) break

      if (elseBody.type === 'if_statement') {
        hasElseIf = true
        currentNode = elseBody
      } else {
        hasElse = true
        break
      }
    }

    if (hasElseIf && !hasElse) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'else-if chain without final else',
        '`if...else if` chain has no final `else` clause — unhandled cases may be silently ignored.',
        sourceCode,
        'Add a final `else` clause to handle unexpected cases, or document why it is intentionally omitted.',
      )
    }
    return null
  },
}

export const accessorPairsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/accessor-pairs',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['object'],
  visit(node, filePath, sourceCode) {
    const getters = new Set<string>()
    const setters = new Set<string>()

    for (const child of node.namedChildren) {
      if (child.type === 'method_definition' || child.type === 'pair') {
        // method_definition: get/set methods in objects
        if (child.type === 'method_definition') {
          const kindNode = child.children.find((c) => c.type === 'get' || c.type === 'set')
          const nameNode = child.childForFieldName('name')
          if (!kindNode || !nameNode) continue
          if (kindNode.type === 'get') getters.add(nameNode.text)
          else if (kindNode.type === 'set') setters.add(nameNode.text)
        }
      }
    }

    // Also check for get/set shorthand in object literals
    for (const child of node.namedChildren) {
      if (child.type === 'method_definition') {
        // Already handled
      } else if (child.type === 'pair') {
        // Regular pair, not a getter/setter
      }
    }

    // Check for setters without getters
    for (const name of setters) {
      if (!getters.has(name)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Setter without getter',
          `Object has a setter for \`${name}\` but no corresponding getter. Add a getter or use a regular property.`,
          sourceCode,
          `Add a getter for \`${name}\`, or convert to a regular data property.`,
        )
      }
    }
    return null
  },
}

export const noReturnAssignVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-return-assign',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['return_statement'],
  visit(node, filePath, sourceCode) {
    const expr = node.namedChildren[0]
    if (!expr) return null

    // Direct assignment in return: return x = value
    if (expr.type === 'assignment_expression' || expr.type === 'augmented_assignment_expression') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Assignment in return',
        'Assignment expression inside `return` statement is confusing — it looks like a comparison.',
        sourceCode,
        'Assign the value to a variable before the `return`, or wrap in extra parentheses if intentional.',
      )
    }
    // Parenthesized assignment: return (x = value)
    if (expr.type === 'parenthesized_expression') {
      const inner = expr.namedChildren[0]
      if (inner?.type === 'assignment_expression' || inner?.type === 'augmented_assignment_expression') {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Assignment in return',
          'Assignment expression inside `return` statement is confusing — it looks like a comparison.',
          sourceCode,
          'Assign the value to a variable before the `return`.',
        )
      }
    }
    return null
  },
}

export const noSequencesVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-sequences',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['sequence_expression'],
  visit(node, filePath, sourceCode) {
    // Don't flag comma expressions in for loop initializer/update positions
    const parent = node.parent
    if (parent?.type === 'for_statement') {
      const initializer = parent.childForFieldName('initializer')
      const increment = parent.childForFieldName('increment')
      if (initializer === node || increment === node) return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Comma operator usage',
      'The comma operator evaluates both expressions but only returns the last value — this is rarely intentional.',
      sourceCode,
      'Use separate statements instead of the comma operator.',
    )
  },
}

export const noCallerVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-caller',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['member_expression'],
  visit(node, filePath, sourceCode) {
    const obj = node.childForFieldName('object')
    const prop = node.childForFieldName('property')

    if (obj?.text === 'arguments' && (prop?.text === 'caller' || prop?.text === 'callee')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        `arguments.${prop?.text} usage`,
        `\`arguments.${prop?.text}\` is deprecated, forbidden in strict mode, and can cause performance issues.`,
        sourceCode,
        `Remove the use of \`arguments.${prop?.text}\`. Use named functions or rest parameters instead.`,
      )
    }
    return null
  },
}

export const noIteratorVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-iterator',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['member_expression', 'pair'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'member_expression') {
      const prop = node.childForFieldName('property')
      if (prop?.text === '__iterator__') {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          '__iterator__ usage',
          '`__iterator__` is non-standard and not supported in modern environments. Use the `Symbol.iterator` protocol instead.',
          sourceCode,
          'Replace `__iterator__` with `[Symbol.iterator]()` to use the standard iteration protocol.',
        )
      }
    }
    if (node.type === 'pair') {
      const key = node.childForFieldName('key')
      if (key?.text === '__iterator__' || key?.text === '"__iterator__"' || key?.text === "'__iterator__'") {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          '__iterator__ usage',
          '`__iterator__` is non-standard and not supported in modern environments. Use the `Symbol.iterator` protocol instead.',
          sourceCode,
          'Replace `__iterator__` with `[Symbol.iterator]()` to use the standard iteration protocol.',
        )
      }
    }
    return null
  },
}

export const requireYieldVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/require-yield',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['generator_function', 'generator_function_declaration'],
  visit(node, filePath, sourceCode) {
    const bodyNode = getFunctionBody(node) ?? node.namedChildren.find((c) => c.type === 'statement_block')
    if (!bodyNode) return null

    let hasYield = false

    function walk(n: SyntaxNode) {
      if (hasYield) return
      if (n.type === 'yield_expression') {
        hasYield = true
        return
      }
      // Don't descend into nested generators
      if ((n.type === 'generator_function' || n.type === 'generator_function_declaration') && n !== node) return
      // Don't descend into regular nested functions either
      if (JS_FUNCTION_TYPES.includes(n.type) && n !== node) return
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child)
      }
    }

    walk(bodyNode)

    if (!hasYield) {
      const nameNode = node.childForFieldName('name')
      const name = nameNode?.text || 'anonymous'
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Generator without yield',
        `Generator function \`${name}\` never uses \`yield\`. Either add \`yield\` or remove the \`*\` to make it a regular function.`,
        sourceCode,
        'Add a `yield` expression, or remove the `*` to make this a regular function.',
      )
    }
    return null
  },
}

export const classPrototypeAssignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/class-prototype-assignment',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['assignment_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    if (!left || left.type !== 'member_expression') return null

    const obj = left.childForFieldName('object')
    const prop = left.childForFieldName('property')
    if (!obj || !prop) return null

    // Pattern: ClassName.prototype.methodName = function(...)
    if (obj.type !== 'member_expression') return null
    const prototypeProp = obj.childForFieldName('property')
    if (prototypeProp?.text !== 'prototype') return null

    const right = node.childForFieldName('right')
    if (right?.type === 'function_expression' || right?.type === 'arrow_function') {
      // Make sure it's not already flagged as extend-native (not a built-in)
      const builtinObj = obj.childForFieldName('object')
      const BUILTINS = new Set(['Array', 'Object', 'String', 'Number', 'Boolean', 'Function',
        'RegExp', 'Date', 'Error', 'Map', 'Set', 'Promise', 'Symbol'])
      if (builtinObj?.type === 'identifier' && BUILTINS.has(builtinObj.text)) return null // handled by extend-native

      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Prototype assignment in class context',
        `Assigning methods via \`${obj.text}\` is inconsistent with ES6 class syntax. Use class method definitions instead.`,
        sourceCode,
        'Move the method into a class body definition.',
      )
    }
    return null
  },
}

export const functionInBlockVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/function-in-block',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['function_declaration'],
  visit(node, filePath, sourceCode) {
    const parent = node.parent
    if (!parent) return null

    // Function declaration directly inside a statement_block that is itself inside a control structure
    if (parent.type === 'statement_block') {
      const grandparent = parent.parent
      const CONTROL_TYPES = new Set(['if_statement', 'else_clause', 'while_statement', 'for_statement',
        'for_in_statement', 'do_statement', 'switch_case', 'switch_default'])
      if (grandparent && CONTROL_TYPES.has(grandparent.type)) {
        const nameNode = node.childForFieldName('name')
        const name = nameNode?.text || 'anonymous'
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Function declaration in block',
          `Function \`${name}\` is declared inside a control flow block. Behavior is inconsistent across environments.`,
          sourceCode,
          'Move the function declaration outside the block, or use a function expression assigned to a `const`.',
        )
      }
    }
    return null
  },
}

export const redundantTypeAliasVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/redundant-type-alias',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['type_alias_declaration'],
  visit(node, filePath, sourceCode) {
    const nameNode = node.childForFieldName('name')
    const typeNode = node.childForFieldName('value')
    if (!nameNode || !typeNode) return null

    // The value should be a single type reference (not a union, intersection, or complex type)
    if (typeNode.type === 'type_identifier') {
      // type Foo = Bar — just a rename with no added meaning
      if (typeNode.text === nameNode.text) return null // self-referential (should not happen but skip)
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Redundant type alias',
        `Type alias \`${nameNode.text}\` just wraps \`${typeNode.text}\` without adding meaning.`,
        sourceCode,
        `Use \`${typeNode.text}\` directly, or rename it to convey semantic meaning.`,
      )
    }
    return null
  },
}

export const redundantOptionalVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/redundant-optional',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['optional_parameter', 'property_signature', 'public_field_definition'],
  visit(node, filePath, sourceCode) {
    // Check for optional property/parameter (has ?) that also includes | undefined in type
    const isOptional = node.children.some((c) => c.text === '?')
    if (!isOptional) return null

    // Find the type annotation node — it's a direct child of type 'type_annotation'
    const typeAnnotation = node.namedChildren.find((c) => c.type === 'type_annotation')
    if (!typeAnnotation) return null

    // The union_type is a named child inside the type_annotation
    function hasUndefinedMember(n: SyntaxNode): boolean {
      // predefined_type: undefined (plain TS)
      if (n.type === 'predefined_type' && n.text === 'undefined') return true
      // literal_type: undefined (tree-sitter-typescript represents `undefined` as literal_type in union)
      if (n.type === 'literal_type' && n.text === 'undefined') return true
      if (n.type === 'union_type') {
        for (let i = 0; i < n.namedChildCount; i++) {
          const child = n.namedChild(i)
          if (child && hasUndefinedMember(child)) return true
        }
        return false
      }
      // Also recurse into type_annotation wrapper
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child && hasUndefinedMember(child)) return true
      }
      return false
    }

    if (hasUndefinedMember(typeAnnotation)) {
      const nameNode = node.childForFieldName('name') ?? node.childForFieldName('pattern')
      const name = nameNode?.text ?? 'property'
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Redundant optional with undefined',
        `\`${name}?\` already implies \`| undefined\` — the explicit \`| undefined\` is redundant.`,
        sourceCode,
        `Remove the explicit \`| undefined\` from the type annotation.`,
      )
    }
    return null
  },
}

export const duplicateTypeConstituentVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/duplicate-type-constituent',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['union_type', 'intersection_type'],
  visit(node, filePath, sourceCode) {
    // Only process the outermost union/intersection
    if (node.parent?.type === node.type) return null

    // Flatten all constituent types
    function flatten(n: SyntaxNode): string[] {
      if (n.type === node.type) {
        const results: string[] = []
        for (let i = 0; i < n.namedChildCount; i++) {
          const child = n.namedChild(i)
          if (child) results.push(...flatten(child))
        }
        return results
      }
      return [n.text.trim()]
    }

    const members = flatten(node)
    const seen = new Set<string>()
    for (const m of members) {
      if (seen.has(m)) {
        const typeWord = node.type === 'union_type' ? 'Union' : 'Intersection'
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Duplicate type constituent',
          `${typeWord} type contains duplicate member \`${m}\`.`,
          sourceCode,
          `Remove the duplicate \`${m}\` from the type.`,
        )
      }
      seen.add(m)
    }
    return null
  },
}

export const equalsInForTerminationVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/equals-in-for-termination',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['for_statement'],
  visit(node, filePath, sourceCode) {
    const condition = node.childForFieldName('condition')
    if (!condition) return null

    function hasEqualityOp(n: SyntaxNode): boolean {
      const op = n.children.find((c) => c.type === '==' || c.type === '===')
      return !!op
    }

    if (hasEqualityOp(condition)) {
      return makeViolation(
        this.ruleKey, condition, filePath, 'low',
        'Equality in for loop termination',
        'Using `==` or `===` in a `for` loop termination condition may cause an infinite loop if the loop variable skips the exact value.',
        sourceCode,
        'Use `<`, `<=`, `>`, or `>=` instead of `==`/`===` for safer loop termination.',
      )
    }
    return null
  },
}

export const CODE_QUALITY_JS_VISITORS: CodeRuleVisitor[] = [
  consoleLogVisitor,
  noExplicitAnyVisitor,
  jsStarImportVisitor,
  jsVarDeclarationVisitor,
  nestedTernaryVisitor,
  nestedTemplateLiteralVisitor,
  tooManyReturnStatementsVisitor,
  collapsibleIfVisitor,
  redundantBooleanVisitor,
  unnecessaryElseAfterReturnVisitor,
  jsNoEmptyFunctionVisitor,
  noUselessCatchVisitor,
  preferTemplateLiteralVisitor,
  noVarDeclarationVisitor,
  cognitiveComplexityVisitor,
  cyclomaticComplexityVisitor,
  tooManyLinesVisitor,
  tooManyBranchesVisitor,
  nestedSwitchVisitor,
  deeplyNestedFunctionsVisitor,
  duplicateStringVisitor,
  unusedExpressionVisitor,
  redundantJumpVisitor,
  noScriptUrlVisitor,
  noThrowLiteralVisitor,
  noLabelVarVisitor,
  noNewWrappersVisitor,
  noProtoVisitor,
  noVoidVisitor,
  preferConstVisitor,
  noDebuggerVisitor,
  noAlertVisitor,
  requireAwaitVisitor,
  noReturnAwaitVisitor,
  expressionComplexityVisitor,
  tooManySwitchCasesVisitor,
  tooManyUnionMembersVisitor,
  tooManyBreaksVisitor,
  identicalFunctionsVisitor,
  unusedVariableVisitor,
  unusedPrivateMemberVisitor,
  deadStoreVisitor,
  unusedCollectionVisitor,
  redundantAssignmentVisitor,
  noLonelyIfVisitor,
  uselessConstructorVisitor,
  uselessEscapeVisitor,
  uselessRenameVisitor,
  uselessComputedKeyVisitor,
  uselessConcatVisitor,
  strictEqualityVisitor,
  commentedOutCodeVisitor,
  invertedBooleanVisitor,
  preferSingleBooleanReturnVisitor,
  preferImmediateReturnVisitor,
  preferWhileVisitor,
  preferObjectSpreadVisitor,
  preferOptionalChainVisitor,
  preferNullishCoalescingVisitor,
  // Batch 3
  preferRestParamsVisitor,
  preferSpreadVisitor,
  parameterReassignmentVisitor,
  labelsUsageVisitor,
  extendNativeVisitor,
  arrayConstructorVisitor,
  functionInLoopVisitor,
  multiAssignVisitor,
  bitwiseInBooleanVisitor,
  forInWithoutFilterVisitor,
  withStatementVisitor,
  defaultCaseLastVisitor,
  elseifWithoutElseVisitor,
  accessorPairsVisitor,
  noReturnAssignVisitor,
  noSequencesVisitor,
  noCallerVisitor,
  noIteratorVisitor,
  requireYieldVisitor,
  classPrototypeAssignmentVisitor,
  functionInBlockVisitor,
  redundantTypeAliasVisitor,
  redundantOptionalVisitor,
  duplicateTypeConstituentVisitor,
  equalsInForTerminationVisitor,
]
