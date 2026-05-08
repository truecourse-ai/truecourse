import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('web-tree-sitter').Node

/**
 * True if `node` lives inside a `function_definition` whose
 * containing scope (skipping decorator/parameters/return-type
 * fields) is a `class_definition`. Method-local imports are the
 * canonical Python pattern for breaking cyclic imports between
 * domain modules; flagging them is high-noise.
 */
function isInsideClassMethod(node: SyntaxNode): boolean {
  let cursor: SyntaxNode | null = node.parent
  let inFunction: SyntaxNode | null = null
  while (cursor) {
    if (cursor.type === 'function_definition' || cursor.type === 'async_function_definition') {
      inFunction = cursor
      break
    }
    if (cursor.type === 'module') return false
    cursor = cursor.parent
  }
  if (!inFunction) return false
  // Walk up from the function's parent until we hit a class /
  // module / outer function. Direct parent of a method's def is
  // `block` whose parent is `class_definition`.
  let p: SyntaxNode | null = inFunction.parent
  while (p) {
    if (p.type === 'class_definition') return true
    if (p.type === 'module' || p.type === 'function_definition' || p.type === 'async_function_definition') return false
    p = p.parent
  }
  return false
}

/**
 * True if `node` lives inside a `try_statement`. The canonical
 * optional-dependency pattern:
 *   try:
 *       import optional_lib
 *   except ImportError:
 *       optional_lib = None
 * Also covers platform-specific best-effort imports.
 */
function isInsideTryBlock(node: SyntaxNode): boolean {
  let cursor: SyntaxNode | null = node.parent
  while (cursor) {
    if (cursor.type === 'try_statement') return true
    if (cursor.type === 'function_definition' || cursor.type === 'class_definition' || cursor.type === 'module') return false
    cursor = cursor.parent
  }
  return false
}

export const pythonImportOutsideTopLevelVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/import-outside-top-level',
  languages: ['python'],
  nodeTypes: ['import_statement', 'import_from_statement'],
  visit(node, filePath, sourceCode) {
    // Optional-dependency / platform-specific best-effort import.
    if (isInsideTryBlock(node)) return null

    // Method-local import — canonical circular-import break point.
    if (isInsideClassMethod(node)) return null

    // Function-local import (module-level function as well as
    // class methods) — Python's canonical lazy-load /
    // circular-break pattern. The analyzer can't statically
    // verify the cycle exists, but the location signal is
    // strong enough that flagging produces ~80% FPs in real
    // codebases. Top-level conditional / loop / context-manager
    // imports outside any function still flag.
    {
      let cursor: SyntaxNode | null = node.parent
      while (cursor) {
        if (cursor.type === 'function_definition' || cursor.type === 'async_function_definition') return null
        if (cursor.type === 'module') break
        cursor = cursor.parent
      }
    }

    // An import is "outside top level" if any ancestor is a function/class/if/for/while/try
    const blockingTypes = new Set([
      'function_definition', 'async_function_definition', 'class_definition',
      'if_statement', 'elif_clause', 'else_clause',
      'for_statement', 'while_statement', 'try_statement',
      'with_statement', 'match_statement',
    ])

    let parent = node.parent
    while (parent) {
      if (blockingTypes.has(parent.type)) {
        // Skip `if TYPE_CHECKING:` and `if sys.version_info >= …:`
        // blocks — these are conventional Python idioms for type-only
        // imports and version-conditional imports. Both are intentional
        // top-level-of-the-module imports gated by a static condition,
        // not "imports inside business logic."
        if (parent.type === 'if_statement') {
          const condition = parent.childForFieldName('condition')
          if (condition) {
            const t = condition.text
            if (
              /\bTYPE_CHECKING\b/.test(t) ||
              /\bsys\.version_info\b/.test(t) ||
              /\bplatform\.system\b/.test(t)
            ) {
              parent = parent.parent
              continue
            }
          }
        }
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Import outside top level',
          'Import statement inside a function or conditional block should be at module top level.',
          sourceCode,
          'Move the import to the top of the module.',
        )
      }
      parent = parent.parent
    }
    return null
  },
}
