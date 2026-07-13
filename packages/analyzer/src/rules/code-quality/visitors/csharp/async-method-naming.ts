import type { Node as SyntaxNode } from 'web-tree-sitter'
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

/**
 * CLR event handlers conventionally do NOT carry the `Async` suffix — the runtime
 * invokes them through a delegate, not by name, and they are the standard use of
 * `async void`. Recognize the two idioms so they aren't flagged:
 *  - the canonical `(object sender, EventArgs e)` signature (first parameter typed
 *    `object`, second a `…EventArgs` type), or
 *  - a method subscribed to an event via `+=` somewhere in the same file
 *    (`source.Changed += OnChanged;`), which covers parameterless handlers.
 */
function isEventHandler(node: SyntaxNode, name: string, sourceCode: string): boolean {
  const params = node.childForFieldName('parameters')
  if (params) {
    const ps = params.namedChildren.filter((c) => c?.type === 'parameter')
    if (ps.length === 2) {
      const t0 = ps[0]?.childForFieldName('type')?.text ?? ''
      const t1 = ps[1]?.childForFieldName('type')?.text ?? ''
      if ((t0 === 'object' || t0 === 'object?') && /EventArgs$/.test(t1)) return true
    }
  }
  return new RegExp('\\+=\\s*(this\\.)?' + name + '\\b').test(sourceCode)
}

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
    if (isEventHandler(node, name, sourceCode)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Async method missing the Async suffix',
      `Async method \`${name}\` does not end in \`Async\`, violating the .NET naming convention.`,
      sourceCode,
      `Rename \`${name}\` to \`${name}Async\`.`,
    )
  },
}
