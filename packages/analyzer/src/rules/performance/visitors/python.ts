/**
 * Performance domain Python visitors.
 */

import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../types.js'
import { makeViolation } from '../../types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PYTHON_LOOP_TYPES = new Set([
  'for_statement',
  'while_statement',
])

function isInsidePythonLoop(node: SyntaxNode): boolean {
  let current = node.parent
  while (current) {
    if (PYTHON_LOOP_TYPES.has(current.type)) return true
    // Stop at function boundaries
    if (current.type === 'function_definition') return false
    current = current.parent
  }
  return false
}

// ---------------------------------------------------------------------------
// 1. quadratic-list-summation — str += in loop
// ---------------------------------------------------------------------------

export const quadraticListSummationVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/quadratic-list-summation',
  languages: ['python'],
  nodeTypes: ['augmented_assignment'],
  visit(node, filePath, sourceCode) {
    const op = node.children.find((c) => c.type === '+=')
    if (!op) return null

    const left = node.childForFieldName('left')
    if (!left) return null

    // Check if the right side is a string or the left is being used as string concat
    const right = node.childForFieldName('right')
    if (!right) return null

    // Heuristic: if += is used inside a loop with string-like values
    if (!isInsidePythonLoop(node)) return null

    // Check if right side is string-like: literal, f-string, str() call, concatenation, or any expression
    const rightType = right.type
    const rightText = right.text
    const isStringLike =
      rightType === 'string' ||
      rightType === 'concatenated_string' ||
      rightType === 'binary_operator' ||
      rightType === 'call' && (rightText.startsWith('str(') || rightText.startsWith('f"') || rightText.startsWith("f'"))

    if (isStringLike) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'String concatenation with += in loop',
        'Building a string with += in a loop creates O(n^2) copies. Use str.join() or a list instead.',
        sourceCode,
        'Collect parts in a list and use "".join(parts) after the loop.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// 2. str-replace-over-re-sub — re.sub for simple string replace
// ---------------------------------------------------------------------------

export const strReplaceOverReSubVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/str-replace-over-re-sub',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const obj = fn.childForFieldName('object')
    const attr = fn.childForFieldName('attribute')
    if (obj?.text !== 're' || attr?.text !== 'sub') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    // If the pattern is a simple string literal (no regex metacharacters), suggest str.replace
    if (firstArg.type === 'string') {
      const patternText = firstArg.text.replace(/^['"]+|['"]+$/g, '')
      // Check for regex metacharacters
      if (!/[.^$*+?{}\\[\]|()]/.test(patternText)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          're.sub() for simple string replacement',
          `re.sub() with a plain string pattern '${patternText}' can be replaced with str.replace() for better performance.`,
          sourceCode,
          'Use str.replace() instead of re.sub() when the pattern is a plain string.',
        )
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// 3. unnecessary-iterable-allocation — list() around generator in for
// ---------------------------------------------------------------------------

export const unnecessaryIterableAllocationVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/unnecessary-iterable-allocation',
  languages: ['python'],
  nodeTypes: ['for_statement'],
  visit(node, filePath, sourceCode) {
    const right = node.childForFieldName('right')
    if (!right || right.type !== 'call') return null

    const fn = right.childForFieldName('function')
    if (!fn || fn.type !== 'identifier' || fn.text !== 'list') return null

    const args = right.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    // If the argument is a generator expression or another iterable call
    if (firstArg.type === 'generator_expression' || firstArg.type === 'call') {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Unnecessary list() allocation in for loop',
        'Wrapping a generator in list() before iterating creates an unnecessary intermediate list. Iterate the generator directly.',
        sourceCode,
        'Remove the list() wrapper and iterate the generator directly.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// 4. sorted-for-min-max — sorted(list)[0] instead of min()
// ---------------------------------------------------------------------------

export const sortedForMinMaxVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/sorted-for-min-max',
  languages: ['python'],
  nodeTypes: ['subscript'],
  visit(node, filePath, sourceCode) {
    const value = node.childForFieldName('value')
    if (!value || value.type !== 'call') return null

    const fn = value.childForFieldName('function')
    if (!fn || fn.type !== 'identifier' || fn.text !== 'sorted') return null

    const subscript = node.childForFieldName('subscript')
    if (!subscript) return null

    const indexText = subscript.text
    // sorted(...)[0] → min(), sorted(...)[-1] → max()
    if (indexText === '0' || indexText === '-1') {
      const replacement = indexText === '0' ? 'min()' : 'max()'
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        `sorted()[${indexText}] instead of ${replacement}`,
        `Using sorted(...)[${indexText}] is O(n log n) when ${replacement} is O(n).`,
        sourceCode,
        `Replace sorted(...)[${indexText}] with ${replacement}.`,
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// 5. list-comprehension-in-any-all — list comp in any()/all()
// ---------------------------------------------------------------------------

export const listCompInAnyAllVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/list-comprehension-in-any-all',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'identifier') return null
    if (fn.text !== 'any' && fn.text !== 'all') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    if (firstArg.type === 'list_comprehension') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        `List comprehension in ${fn.text}()`,
        `${fn.text}([...]) creates the entire list before checking. Use a generator expression ${fn.text}(... for ...) for short-circuit evaluation.`,
        sourceCode,
        `Replace the list comprehension [...] with a generator expression (...) inside ${fn.text}().`,
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// 6. unnecessary-list-cast — list() around list comprehension
// ---------------------------------------------------------------------------

export const unnecessaryListCastVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/unnecessary-list-cast',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'identifier' || fn.text !== 'list') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    if (firstArg.type === 'list_comprehension') {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Unnecessary list() around list comprehension',
        'list([... for ...]) is redundant. A list comprehension already returns a list.',
        sourceCode,
        'Remove the outer list() call and use the list comprehension directly.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// 7. incorrect-dict-iterator — .keys()/.values() when .items() is needed
// ---------------------------------------------------------------------------

export const incorrectDictIteratorVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/incorrect-dict-iterator',
  languages: ['python'],
  nodeTypes: ['for_statement'],
  visit(node, filePath, sourceCode) {
    const right = node.childForFieldName('right')
    if (!right || right.type !== 'call') return null

    const fn = right.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const attr = fn.childForFieldName('attribute')
    if (!attr) return null

    if (attr.text !== 'keys' && attr.text !== 'values') return null

    const obj = fn.childForFieldName('object')
    if (!obj) return null
    const dictName = obj.text

    // Check if the loop body accesses the dict with the key
    const body = node.childForFieldName('body')
    if (!body) return null

    const left = node.childForFieldName('left')
    if (!left) return null
    const iterVar = left.text

    const bodyText = body.text

    if (attr.text === 'keys') {
      // If iterating .keys() but body accesses dict[key], suggest .items()
      if (bodyText.includes(`${dictName}[${iterVar}]`)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Iterating .keys() but accessing values by key',
          `Iterating ${dictName}.keys() and accessing ${dictName}[${iterVar}] in the body. Use .items() to get both key and value directly.`,
          sourceCode,
          `Replace ${dictName}.keys() with ${dictName}.items() and destructure key, value.`,
        )
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// 8. try-except-in-loop — try/except inside tight loop
// ---------------------------------------------------------------------------

export const tryExceptInLoopVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/try-except-in-loop',
  languages: ['python'],
  nodeTypes: ['try_statement'],
  visit(node, filePath, sourceCode) {
    if (!isInsidePythonLoop(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'try/except inside loop',
      'try/except inside a loop adds overhead per iteration. Move the try/except outside the loop if possible.',
      sourceCode,
      'Wrap the entire loop in a try/except, or use a conditional check instead of exception handling.',
    )
  },
}

// ---------------------------------------------------------------------------
// 9. manual-list-comprehension — loop appending to list
// ---------------------------------------------------------------------------

export const manualListComprehensionVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/manual-list-comprehension',
  languages: ['python'],
  nodeTypes: ['for_statement'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    // Check if the body is just a single .append() call (or block with one statement)
    const statements = body.namedChildren.filter((c) => c.type !== 'comment')
    if (statements.length !== 1) return null

    const stmt = statements[0]
    if (!stmt) return null

    // expression_statement > call > attribute with .append
    const expr = stmt.type === 'expression_statement' ? stmt.namedChildren[0] : stmt
    if (!expr || expr.type !== 'call') return null

    const fn = expr.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const attr = fn.childForFieldName('attribute')
    if (attr?.text !== 'append') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Manual loop appending instead of list comprehension',
      'For loop with a single .append() call can be replaced with a list comprehension for clarity and performance.',
      sourceCode,
      'Replace the loop with a list comprehension: result = [expr for item in iterable].',
    )
  },
}

// ---------------------------------------------------------------------------
// 10. torch-dataloader-num-workers — DataLoader with num_workers=0
// ---------------------------------------------------------------------------

export const torchDataloaderNumWorkersVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/torch-dataloader-num-workers',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let name = ''
    if (fn.type === 'identifier') name = fn.text
    else if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      if (attr) name = attr.text
    }

    if (name !== 'DataLoader') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Check for num_workers keyword argument
    let hasNumWorkers = false
    for (const arg of args.namedChildren) {
      if (arg.type === 'keyword_argument') {
        const argName = arg.childForFieldName('name')
        if (argName?.text === 'num_workers') {
          hasNumWorkers = true
          const value = arg.childForFieldName('value')
          if (value?.text === '0') {
            return makeViolation(
              this.ruleKey, node, filePath, 'medium',
              'DataLoader with num_workers=0',
              'DataLoader with num_workers=0 loads data in the main process, which is a bottleneck for GPU training.',
              sourceCode,
              'Set num_workers to a positive value (e.g., 4 or os.cpu_count()) for parallel data loading.',
            )
          }
        }
      }
    }

    // If no num_workers specified at all, it defaults to 0
    if (!hasNumWorkers) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'DataLoader without num_workers',
        'DataLoader defaults to num_workers=0, loading data in the main process. This is a bottleneck for GPU training.',
        sourceCode,
        'Set num_workers to a positive value (e.g., 4 or os.cpu_count()) for parallel data loading.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// 11. missing-slots-in-subclass — Subclass missing __slots__
// ---------------------------------------------------------------------------

export const missingSlotsInSubclassVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/missing-slots-in-subclass',
  languages: ['python'],
  nodeTypes: ['class_definition'],
  visit(node, filePath, sourceCode) {
    // Check if class has a superclass
    const superclasses = node.childForFieldName('superclasses')
    if (!superclasses || superclasses.namedChildren.length === 0) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    // Check if parent class is known to have __slots__ by looking if class body uses __slots__
    const bodyText = body.text
    const hasSlots = bodyText.includes('__slots__')

    if (hasSlots) return null

    // Check if any superclass has __slots__ (heuristic: look in the source for __slots__ in context)
    // Only flag if the class defines instance attributes
    const hasInstanceAttrs = bodyText.includes('self.')
    if (!hasInstanceAttrs) return null

    // Check if any parent in source defines __slots__
    const parentNames = superclasses.namedChildren.map((c) => c.text)
    // Simple heuristic: only flag if file itself defines a parent with __slots__
    for (const parentName of parentNames) {
      const parentPattern = new RegExp(`class\\s+${parentName}[^:]*:[\\s\\S]*?__slots__`)
      if (parentPattern.test(sourceCode)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Subclass missing __slots__',
          `Class inherits from ${parentName} which uses __slots__, but does not define its own __slots__. This negates the memory savings of __slots__.`,
          sourceCode,
          'Add __slots__ to the subclass listing any new attributes it defines.',
        )
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// 12. batch-writes-in-loop — DB write inside loop
// ---------------------------------------------------------------------------

const PYTHON_DB_WRITE_METHODS = new Set([
  'save', 'insert', 'create', 'update', 'delete', 'execute', 'add', 'commit',
])

export const batchWritesInLoopVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/batch-writes-in-loop',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const attr = fn.childForFieldName('attribute')
    if (!attr || !PYTHON_DB_WRITE_METHODS.has(attr.text)) return null

    if (!isInsidePythonLoop(node)) return null

    // Exclude commit() as it's often at the end of loops intentionally
    if (attr.text === 'commit') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Database write inside loop',
      `Calling .${attr.text}() inside a loop performs individual writes. Use bulk operations instead.`,
      sourceCode,
      `Use bulk_create(), executemany(), or batch the operations and call .${attr.text}() once after the loop.`,
    )
  },
}

// ---------------------------------------------------------------------------
// 13. set-mutations-in-loop — set.add() in loop
// ---------------------------------------------------------------------------

export const setMutationsInLoopVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/set-mutations-in-loop',
  languages: ['python'],
  nodeTypes: ['for_statement'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    // Check if the body is just a single .add() call
    const statements = body.namedChildren.filter((c) => c.type !== 'comment')
    if (statements.length !== 1) return null

    const stmt = statements[0]
    if (!stmt) return null

    const expr = stmt.type === 'expression_statement' ? stmt.namedChildren[0] : stmt
    if (!expr || expr.type !== 'call') return null

    const fn = expr.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const attr = fn.childForFieldName('attribute')
    if (attr?.text !== 'add') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'set.add() in loop instead of set update',
      'Calling set.add() in a loop with a single element can be replaced with set.update() or a set comprehension.',
      sourceCode,
      'Use my_set.update(iterable) or my_set = {expr for item in iterable} instead.',
    )
  },
}

// ---------------------------------------------------------------------------
// 14. runtime-cast-overhead — Type casting in hot loop
// ---------------------------------------------------------------------------

const PYTHON_CAST_FUNCTIONS = new Set(['int', 'float', 'str', 'bool', 'list', 'tuple', 'dict', 'set', 'bytes'])

export const runtimeCastOverheadVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/runtime-cast-overhead',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'identifier') return null
    if (!PYTHON_CAST_FUNCTIONS.has(fn.text)) return null

    if (!isInsidePythonLoop(node)) return null

    // Only flag if it looks like the same conversion is repeated (heuristic: the argument is the loop variable)
    // Simple heuristic: just flag type casts in loops
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Type casting in loop',
      `${fn.text}() called inside a loop. If the type is known, consider pre-processing the data before the loop.`,
      sourceCode,
      'Pre-process or convert data before the loop to avoid per-iteration cast overhead.',
    )
  },
}

// ---------------------------------------------------------------------------
// Export all visitors
// ---------------------------------------------------------------------------

export const PERFORMANCE_PYTHON_VISITORS: CodeRuleVisitor[] = [
  quadraticListSummationVisitor,
  strReplaceOverReSubVisitor,
  unnecessaryIterableAllocationVisitor,
  sortedForMinMaxVisitor,
  listCompInAnyAllVisitor,
  unnecessaryListCastVisitor,
  incorrectDictIteratorVisitor,
  tryExceptInLoopVisitor,
  manualListComprehensionVisitor,
  torchDataloaderNumWorkersVisitor,
  missingSlotsInSubclassVisitor,
  batchWritesInLoopVisitor,
  setMutationsInLoopVisitor,
  runtimeCastOverheadVisitor,
]
