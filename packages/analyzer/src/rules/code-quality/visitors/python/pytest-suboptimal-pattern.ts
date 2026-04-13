import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getPythonDecoratorName, getPythonDecoratorFullName } from '../../../_shared/python-helpers.js'

/**
 * Detects suboptimal pytest patterns:
 * - PT007: pytest.mark.parametrize values should use tuples
 * - PT008: use return_value= instead of lambda in patch
 * - PT013: import pytest not py.test
 * - PT020: deprecated yield_fixture
 * - PT021: use yield instead of request.addfinalizer
 * - PT022: useless yield fixture
 * - PT024: unnecessary asyncio mark on fixture
 */
export const pythonPytestSuboptimalPatternVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/pytest-suboptimal-pattern',
  languages: ['python'],
  nodeTypes: ['call', 'import_from_statement', 'decorated_definition'],
  visit(node, filePath, sourceCode) {
    // PT013: import from py.test (should be pytest)
    if (node.type === 'import_from_statement') {
      const moduleNode = node.childForFieldName('module_name') ?? node.children.find((c) => c.type === 'dotted_name' || c.type === 'identifier')
      if (moduleNode?.text === 'py.test' || moduleNode?.text === 'py') {
        const names = node.children.filter((c) => c.type === 'dotted_name' || c.type === 'identifier')
        if (names.some((n) => n.text === 'test')) {
          return makeViolation(
            this.ruleKey, node, filePath, 'low',
            'Suboptimal pytest pattern: import from py.test',
            '`import pytest` should be used instead of `from py import test`.',
            sourceCode,
            'Replace `from py import test` with `import pytest`.',
          )
        }
      }
    }

    if (node.type === 'decorated_definition') {
      const decorators = node.children.filter((c) => c.type === 'decorator')
      for (const d of decorators) {
        // PT020: deprecated @pytest.yield_fixture
        if (getPythonDecoratorName(d) === 'yield_fixture') {
          return makeViolation(
            this.ruleKey, node, filePath, 'low',
            'Suboptimal pytest pattern: deprecated yield_fixture',
            '`@pytest.yield_fixture` is deprecated. Use `@pytest.fixture` with `yield` instead.',
            sourceCode,
            'Replace `@pytest.yield_fixture` with `@pytest.fixture` and use `yield` in the body.',
          )
        }
        // PT024: unnecessary asyncio mark on fixture
        if (getPythonDecoratorFullName(d) === 'pytest.mark.asyncio') {
          // Check if the decorated definition also has a @pytest.fixture or @fixture decorator
          const hasFixture = decorators.some((other) =>
            getPythonDecoratorName(other) === 'fixture')
          if (hasFixture) {
            return makeViolation(
              this.ruleKey, node, filePath, 'low',
              'Suboptimal pytest pattern: unnecessary asyncio mark on fixture',
              '`@pytest.mark.asyncio` is unnecessary on `@pytest.fixture` — fixtures do not need this mark.',
              sourceCode,
              'Remove the `@pytest.mark.asyncio` decorator from the fixture.',
            )
          }
        }
      }
    }

    if (node.type === 'call') {
      const fn = node.childForFieldName('function')
      if (!fn) return null
      const fnText = fn.text

      // PT008: use return_value= instead of lambda in patch
      if (
        fnText === 'mock.patch' ||
        fnText === 'patch' ||
        fnText.endsWith('.patch')
      ) {
        const args = node.childForFieldName('arguments')
        if (args) {
          for (const arg of args.namedChildren) {
            if (arg.type === 'keyword_argument') {
              const key = arg.childForFieldName('name')
              const val = arg.childForFieldName('value')
              if (key?.text !== 'return_value' && val?.type === 'lambda') {
                return makeViolation(
                  this.ruleKey, node, filePath, 'low',
                  'Suboptimal pytest pattern: lambda in patch',
                  'Use `return_value=` keyword argument instead of a lambda in `mock.patch()`.',
                  sourceCode,
                  'Replace the lambda with `return_value=<value>` in the patch call.',
                )
              }
            }
          }
        }
      }

      // PT021: use yield instead of request.addfinalizer
      if (fnText === 'request.addfinalizer' || (fn.type === 'attribute' && fn.childForFieldName('attribute')?.text === 'addfinalizer')) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Suboptimal pytest pattern: request.addfinalizer',
          'Use `yield` in the fixture instead of `request.addfinalizer()` for cleanup.',
          sourceCode,
          'Convert the fixture to use `yield` and move cleanup code after the `yield`.',
        )
      }
    }

    return null
  },
}
