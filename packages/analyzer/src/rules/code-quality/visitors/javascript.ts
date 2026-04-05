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
]
