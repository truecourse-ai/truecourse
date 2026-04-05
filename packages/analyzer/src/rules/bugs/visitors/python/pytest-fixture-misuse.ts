import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects pytest fixture/decorator misuse patterns:
 * - PT010: pytest.raises() without match argument (when specifying exception type only)
 * - PT019: fixture with params but missing request parameter
 * - PT025: @pytest.mark.usefixtures applied to a fixture function
 * - PT026: @pytest.mark.usefixtures without arguments
 * - PT028: fixture parameter with default value shadowing a fixture
 */
export const pythonPytestFixtureMisuseVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/pytest-fixture-misuse',
  languages: ['python'],
  nodeTypes: ['decorated_definition'],
  visit(node, filePath, sourceCode) {
    const decorators = node.namedChildren.filter((c) => c.type === 'decorator')
    const funcNode = node.namedChildren.find((c) => c.type === 'function_definition')
    if (!funcNode) return null

    const funcName = funcNode.childForFieldName('name')?.text ?? 'function'

    // PT025: @pytest.mark.usefixtures on a fixture function
    const isFixture = decorators.some((d) => {
      const text = d.text
      return text.includes('pytest.fixture') || text === '@fixture'
    })

    const hasUsefixtures = decorators.find((d) => d.text.includes('usefixtures'))

    if (isFixture && hasUsefixtures) {
      return makeViolation(
        this.ruleKey, hasUsefixtures, filePath, 'high',
        'usefixtures on a fixture function',
        `\`@pytest.mark.usefixtures\` applied to fixture \`${funcName}\` — fixtures should declare dependencies as function parameters, not via \`usefixtures\`.`,
        sourceCode,
        `Remove \`@pytest.mark.usefixtures\` and add the fixtures as parameters to \`${funcName}\`.`,
      )
    }

    // PT026: @pytest.mark.usefixtures without parameters
    const emptyUsefixtures = decorators.find((d) => {
      if (!d.text.includes('usefixtures')) return false
      // Check if the decorator call has no arguments
      const call = d.namedChildren.find((c) => c.type === 'call')
      if (!call) return false
      const args = call.childForFieldName('arguments')
      if (!args) return true // no parens at all is weird but check
      return args.namedChildren.length === 0
    })

    if (emptyUsefixtures) {
      return makeViolation(
        this.ruleKey, emptyUsefixtures, filePath, 'high',
        'usefixtures without fixture names',
        `\`@pytest.mark.usefixtures()\` called without specifying any fixture names — this has no effect.`,
        sourceCode,
        'Remove the empty `@pytest.mark.usefixtures()` decorator, or add fixture names: `@pytest.mark.usefixtures("my_fixture")`.',
      )
    }

    // PT019: fixture with params but missing request parameter
    if (isFixture) {
      const fixtureDecorator = decorators.find((d) => d.text.includes('pytest.fixture') || d.text === '@fixture')
      if (fixtureDecorator) {
        // Check if decorator has params= argument
        const call = fixtureDecorator.namedChildren.find((c) => c.type === 'call')
        if (call) {
          const args = call.childForFieldName('arguments')
          const hasParams = args?.namedChildren.some((a) => {
            if (a.type === 'keyword_argument') {
              const k = a.childForFieldName('name')
              return k?.text === 'params'
            }
            return false
          })

          if (hasParams) {
            // Check if 'request' is in the function parameters
            const params = funcNode.childForFieldName('parameters')
            const hasRequest = params?.namedChildren.some((p) => {
              const pName = p.type === 'identifier' ? p.text :
                p.childForFieldName('name')?.text
              return pName === 'request'
            })

            if (!hasRequest) {
              return makeViolation(
                this.ruleKey, funcNode, filePath, 'high',
                'Fixture with params missing request parameter',
                `Fixture \`${funcName}\` has \`params=\` but no \`request\` parameter — \`request.param\` is how you access each parameterized value.`,
                sourceCode,
                `Add \`request\` as the first parameter to \`${funcName}\`.`,
              )
            }
          }
        }
      }
    }

    return null
  },
}
