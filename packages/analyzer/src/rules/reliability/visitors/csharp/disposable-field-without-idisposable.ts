import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { declaresIDisposable, getDisposableFields } from './_helpers.js'

/**
 * A class that owns an instance field of a well-known disposable type but does
 * not itself implement IDisposable. The field's resource then has no
 * deterministic release path — it leaks until finalization (if any).
 *
 * Precision (no type info, so a curated disposable-type set drives matching):
 *   - only instance fields of a known-disposable type count (statics are
 *     process-lifetime singletons by convention);
 *   - skipped when the class already declares IDisposable / IAsyncDisposable
 *     (whether it disposes correctly is the dispose-own-members rule's job).
 */
export const csharpDisposableFieldWithoutIDisposableVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/disposable-field-without-idisposable',
  languages: ['csharp'],
  nodeTypes: ['class_declaration'],
  visit(node, filePath, sourceCode) {
    if (declaresIDisposable(node)) return null

    const fields = getDisposableFields(node)
    if (fields.length === 0) return null

    const first = fields[0]!
    return makeViolation(
      this.ruleKey, first.node, filePath, 'medium',
      'Owns a disposable field but is not disposable',
      `This class holds the disposable field '${first.name}' (${first.typeName}) but does not implement IDisposable, so the resource it owns has no deterministic release path and leaks until finalization.`,
      sourceCode,
      'Implement IDisposable and dispose the field in Dispose(), or take the resource as an injected dependency owned by the caller.',
    )
  },
}
