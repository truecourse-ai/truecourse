import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'
import { isCSharpTestMethod, getCSharpDeclAttributeNames } from './_helpers.js'

/**
 * The .NET convention is that an asynchronous method's name ends in `Async`, so
 * call sites read clearly and the await-or-not decision is visible. The check
 * fires on a `method_declaration` carrying the `async` modifier whose name does
 * not end in `Async`.
 *
 * False-positive guards:
 *  - `override` implementations must match a base/interface name (can't rename);
 *  - `Main` is the entry point;
 *  - test methods follow their own naming;
 *  - framework handler methods bound by attribute — ASP.NET controller actions
 *    (`[HttpGet]`/`[Route]`/…), minimal-API/SignalR handlers — must NOT carry
 *    the `Async` suffix (the framework strips it from routing), so any method
 *    with a routing/handler attribute is exempt.
 * Anonymous async lambdas have no name and are never the subject of this rule.
 */
const HANDLER_ATTRIBUTES = new Set([
  'HttpGet', 'HttpPost', 'HttpPut', 'HttpDelete', 'HttpPatch', 'HttpHead', 'HttpOptions',
  'Route', 'Area', 'AcceptVerbs',
])

export const csharpAsyncMethodNamingVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/async-method-naming',
  languages: ['csharp'],
  nodeTypes: ['method_declaration'],
  visit(node, filePath, sourceCode) {
    if (!hasCSharpModifier(node, 'async')) return null
    if (hasCSharpModifier(node, 'override')) return null

    const name = node.childForFieldName('name')?.text
    if (!name || name.endsWith('Async')) return null
    if (name === 'Main') return null
    if (isCSharpTestMethod(node)) return null
    if (getCSharpDeclAttributeNames(node).some((a) => HANDLER_ATTRIBUTES.has(a))) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Async method missing the Async suffix',
      `Async method \`${name}\` does not end in \`Async\`, violating the .NET naming convention.`,
      sourceCode,
      `Rename \`${name}\` to \`${name}Async\`.`,
    )
  },
}
