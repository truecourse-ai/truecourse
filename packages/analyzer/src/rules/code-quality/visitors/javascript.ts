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
]
