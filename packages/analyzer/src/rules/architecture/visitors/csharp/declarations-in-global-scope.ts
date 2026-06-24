import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier, getCSharpAttributeNames } from '../../../_shared/csharp-helpers.js'

/**
 * Mutable global state — the C# form of a module-scope mutable variable is a
 * `static` field that is neither `readonly` nor `const`: shared across the
 * whole process, mutable from anywhere, a unit-test isolation and
 * concurrency hazard.
 */
// Test infrastructure holds shared state by design (OneTimeSetUp fixtures,
// WebApplicationFactory instances) — flagging it would fight the frameworks.
// Matched by .NET naming conventions (PascalCase test file/class/project
// names), not bare lowercase path segments, which collide with non-test
// directories (e.g. a repo's tests/fixtures tree holding production-shaped
// sample code) — and by a unit-test framework import, since real test
// classes are not always named `*Tests.cs`.
const TEST_PATH = /Tests?\.cs$|TestSetup|TestApp|Fixture|FunctionalTests|UnitTests|IntegrationTests/
const TEST_FRAMEWORK_IMPORT = /^\s*(?:global\s+)?using\s+(?:NUnit\.Framework|Xunit|Microsoft\.VisualStudio\.TestTools\.UnitTesting)\b/m

export const csharpDeclarationsInGlobalScopeVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/declarations-in-global-scope',
  languages: ['csharp'],
  nodeTypes: ['field_declaration'],
  visit(node, filePath, sourceCode) {
    if (!hasCSharpModifier(node, 'static')) return null
    if (hasCSharpModifier(node, 'readonly') || hasCSharpModifier(node, 'const')) return null
    // `[ThreadStatic]` storage is per-thread, not shared process-wide — the
    // opposite of the concurrency/isolation hazard this rule targets.
    if (getCSharpAttributeNames(node).includes('ThreadStatic')) return null
    if (TEST_PATH.test(filePath)) return null
    if (TEST_FRAMEWORK_IMPORT.test(sourceCode)) return null

    const varDecl = node.namedChildren.find((c) => c?.type === 'variable_declaration')
    const declarator = varDecl?.namedChildren.find((c) => c?.type === 'variable_declarator')
    const name = declarator?.childForFieldName('name')?.text ?? declarator?.namedChildren[0]?.text ?? 'field'

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Global scope declaration',
      `Static field '${name}' is mutable process-global state. Make it readonly/const, or scope it to an injected service.`,
      sourceCode,
      'Make the field readonly or const, or move the state into a dependency-injected service.',
    )
  },
}
