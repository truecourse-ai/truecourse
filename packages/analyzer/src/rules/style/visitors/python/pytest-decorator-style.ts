import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

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
