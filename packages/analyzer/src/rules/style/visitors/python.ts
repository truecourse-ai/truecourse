/**
 * Style domain Python visitors.
 */

import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../types.js'
import { makeViolation } from '../../types.js'

// ---------------------------------------------------------------------------
// import-formatting — Import not at top of file (Python)
// ---------------------------------------------------------------------------

export const pythonImportFormattingVisitor: CodeRuleVisitor = {
  ruleKey: 'style/deterministic/import-formatting',
  languages: ['python'],
  nodeTypes: ['import_statement', 'import_from_statement'],
  visit(node, filePath, sourceCode) {
    const parent = node.parent
    if (!parent || parent.type !== 'module') return null

    let sawNonImport = false
    let isFirstStatement = true
    for (const child of parent.namedChildren) {
      if (child === node) {
        if (sawNonImport) {
          return makeViolation(
            this.ruleKey, node, filePath, 'low',
            'Import not at top of file',
            'Import statement found after non-import code. Group all imports at the top of the module.',
            sourceCode,
            'Move this import to the top of the file with the other imports.',
          )
        }
        return null
      }
      if (
        child.type !== 'import_statement' &&
        child.type !== 'import_from_statement' &&
        child.type !== 'comment'
      ) {
        // Allow module docstring (expression_statement with string) as first non-comment
        if (isFirstStatement && child.type === 'expression_statement') {
          const firstChild = child.namedChildren[0]
          if (firstChild?.type === 'string') {
            isFirstStatement = false
            continue
          }
        }
        sawNonImport = true
      }
      isFirstStatement = false
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// implicit-string-concatenation — Adjacent string literals
// ---------------------------------------------------------------------------

export const pythonImplicitStringConcatVisitor: CodeRuleVisitor = {
  ruleKey: 'style/deterministic/implicit-string-concatenation',
  languages: ['python'],
  nodeTypes: ['concatenated_string'],
  visit(node, filePath, sourceCode) {
    // Python's implicit string concatenation: "hello" "world"
    // Only flag if on the same line (multi-line is intentional)
    if (node.startPosition.row === node.endPosition.row) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Implicit string concatenation',
        'Adjacent string literals are implicitly concatenated. This may be unintentional (missing comma in list?).',
        sourceCode,
        'Use explicit + operator or add a comma if this is a list/tuple element.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// comment-tag-formatting — Malformed TODO/FIXME (Python)
// ---------------------------------------------------------------------------

export const pythonCommentTagFormattingVisitor: CodeRuleVisitor = {
  ruleKey: 'style/deterministic/comment-tag-formatting',
  languages: ['python'],
  nodeTypes: ['comment'],
  visit(node, filePath, sourceCode) {
    const text = node.text

    const match = text.match(/\b(TODO|FIXME|HACK|XXX)\s+[^:]/)
    if (match) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        `Malformed ${match[1]} comment`,
        `${match[1]} comment should use colon format: '${match[1]}: description'.`,
        sourceCode,
        `Format as: # ${match[1]}: description`,
      )
    }

    const emptyMatch = text.match(/\b(TODO|FIXME|HACK|XXX):?\s*$/)
    if (emptyMatch) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        `Empty ${emptyMatch[1]} comment`,
        `${emptyMatch[1]} comment has no description.`,
        sourceCode,
        `Add a description: # ${emptyMatch[1]}: what needs to be done`,
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// pytest-decorator-style
// ---------------------------------------------------------------------------

export const pytestDecoratorStyleVisitor: CodeRuleVisitor = {
  ruleKey: 'style/deterministic/pytest-decorator-style',
  languages: ['python'],
  nodeTypes: ['decorator'],
  visit(node, filePath, sourceCode) {
    const text = node.text

    // @pytest.mark.parametrize without parentheses
    if (text.includes('pytest.mark.parametrize') && !text.includes('(')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'pytest.mark.parametrize missing arguments',
        '@pytest.mark.parametrize requires arguments with parameter names and values.',
        sourceCode,
        'Add arguments: @pytest.mark.parametrize("param", [value1, value2])',
      )
    }

    // @pytest.fixture used as @pytest.fixture() with no arguments — style preference
    // Both are valid but consistency matters
    return null
  },
}

// ---------------------------------------------------------------------------
// python-naming-convention — snake_case for functions, PascalCase for classes
// ---------------------------------------------------------------------------

export const pythonNamingConventionVisitor: CodeRuleVisitor = {
  ruleKey: 'style/deterministic/python-naming-convention',
  languages: ['python'],
  nodeTypes: ['function_definition', 'class_definition'],
  visit(node, filePath, sourceCode) {
    const name = node.childForFieldName('name')
    if (!name) return null

    const identifier = name.text

    if (node.type === 'class_definition') {
      // Classes should be PascalCase
      if (identifier.includes('_') && !identifier.startsWith('_')) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Class not in PascalCase',
          `Class '${identifier}' uses snake_case. Python convention is PascalCase for classes.`,
          sourceCode,
          `Rename to PascalCase: ${identifier.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')}.`,
        )
      }
    }

    if (node.type === 'function_definition') {
      // Functions should be snake_case — skip dunder methods and private
      if (identifier.startsWith('__') && identifier.endsWith('__')) return null

      // PascalCase function in Python is suspicious
      if (/^[A-Z][a-z]/.test(identifier) && !identifier.includes('_')) {
        // Could be a class factory, but flag it
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Function in PascalCase',
          `Function '${identifier}' uses PascalCase. Python convention is snake_case for functions.`,
          sourceCode,
          'Rename to snake_case unless this is intentionally a class-like factory.',
        )
      }

      // camelCase function in Python
      if (/^[a-z]+[A-Z]/.test(identifier) && !identifier.includes('_')) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Function in camelCase',
          `Function '${identifier}' uses camelCase. Python convention is snake_case for functions.`,
          sourceCode,
          `Rename to snake_case: ${identifier.replace(/[A-Z]/g, c => '_' + c.toLowerCase())}.`,
        )
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// docstring-completeness — Missing docstring for public functions/classes
// ---------------------------------------------------------------------------

export const pythonDocstringCompletenessVisitor: CodeRuleVisitor = {
  ruleKey: 'style/deterministic/docstring-completeness',
  languages: ['python'],
  nodeTypes: ['function_definition', 'class_definition'],
  visit(node, filePath, sourceCode) {
    const name = node.childForFieldName('name')
    if (!name) return null

    // Skip private functions
    if (name.text.startsWith('_')) return null

    // Only flag top-level or class-level definitions
    const parent = node.parent
    if (!parent) return null
    if (parent.type !== 'module' && parent.type !== 'block') return null

    const body = node.childForFieldName('body')
    if (!body) return null

    // Check if first statement is a string expression (docstring)
    const firstStmt = body.namedChildren[0]
    if (!firstStmt) return null

    const isDocstring =
      firstStmt.type === 'expression_statement' &&
      firstStmt.namedChildren[0]?.type === 'string'

    if (!isDocstring) {
      const kind = node.type === 'class_definition' ? 'Class' : 'Function'
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        `${kind} missing docstring`,
        `Public ${kind.toLowerCase()} '${name.text}' has no docstring.`,
        sourceCode,
        `Add a docstring: def ${name.text}(...):\n    """Description."""`,
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// python-minor-style-preference — missing trailing comma
// ---------------------------------------------------------------------------

export const pythonMinorStyleVisitor: CodeRuleVisitor = {
  ruleKey: 'style/deterministic/python-minor-style-preference',
  languages: ['python'],
  nodeTypes: ['dictionary', 'list', 'tuple', 'argument_list'],
  visit(node, filePath, sourceCode) {
    // Only check multi-line collections
    if (node.startPosition.row === node.endPosition.row) return null

    // Skip argument_list that's not multi-line function call args
    if (node.type === 'argument_list' && node.namedChildren.length < 2) return null

    const children = node.namedChildren
    if (children.length === 0) return null

    const lastChild = children[children.length - 1]
    if (!lastChild) return null

    // Check if there's a comma after the last element
    const textAfterLastChild = sourceCode.substring(lastChild.endIndex, node.endIndex)
    const hasTrailingComma = textAfterLastChild.trimStart().startsWith(',')

    if (!hasTrailingComma && node.endPosition.row > lastChild.endPosition.row) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Missing trailing comma in multi-line collection',
        'Multi-line collection/function call without a trailing comma. Adding one makes diffs cleaner.',
        sourceCode,
        'Add a trailing comma after the last element.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// whitespace-formatting — mixed tabs/spaces (Python)
// ---------------------------------------------------------------------------

export const pythonWhitespaceFormattingVisitor: CodeRuleVisitor = {
  ruleKey: 'style/deterministic/whitespace-formatting',
  languages: ['python'],
  nodeTypes: ['module'],
  visit(node, filePath, sourceCode) {
    const lines = sourceCode.split('\n')
    let hasTabs = false
    let hasSpaces = false

    for (const line of lines) {
      const leadingWhitespace = line.match(/^(\s+)/)?.[1]
      if (leadingWhitespace) {
        if (leadingWhitespace.includes('\t')) hasTabs = true
        if (leadingWhitespace.includes(' ')) hasSpaces = true
      }
    }

    if (hasTabs && hasSpaces) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Mixed tabs and spaces',
        'File uses both tabs and spaces for indentation. Python requires consistent indentation.',
        sourceCode,
        'Use spaces (4 per level) consistently, as recommended by PEP 8.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// Export all visitors
// ---------------------------------------------------------------------------

export const STYLE_PYTHON_VISITORS: CodeRuleVisitor[] = [
  pythonImportFormattingVisitor,
  pythonImplicitStringConcatVisitor,
  pythonCommentTagFormattingVisitor,
  pytestDecoratorStyleVisitor,
  pythonNamingConventionVisitor,
  pythonDocstringCompletenessVisitor,
  pythonMinorStyleVisitor,
  pythonWhitespaceFormattingVisitor,
]
