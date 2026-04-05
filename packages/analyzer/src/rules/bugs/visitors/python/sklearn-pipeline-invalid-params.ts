import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects invalid nested parameter names in sklearn Pipeline set_params() calls.
 * Pipeline params use the convention step_name__param_name.
 * Common errors: wrong separator (single underscore), missing step name.
 */
export const pythonSklearnPipelineInvalidParamsVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/sklearn-pipeline-invalid-params',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    const fnText = fn.text
    // Match .set_params() or .fit() with keyword args that look like pipeline params
    if (!fnText.endsWith('.set_params') && !fnText.endsWith('.fit')) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Check keyword arguments for pipeline-style params
    for (const child of args.namedChildren) {
      if (child.type !== 'keyword_argument') continue

      const key = child.childForFieldName('name')
      if (!key) continue

      const paramName = key.text

      // Pipeline params should use double underscore: step__param
      // If there's a single underscore that looks like it should be double
      if (paramName.includes('__')) {
        // Valid pipeline param format — check for triple underscores (common typo)
        if (paramName.includes('___')) {
          return makeViolation(
            this.ruleKey, child, filePath, 'high',
            'Invalid pipeline parameter',
            `Parameter '${paramName}' contains triple underscores — pipeline parameters use double underscores (step__param).`,
            sourceCode,
            'Use double underscores to separate step name and parameter name.',
          )
        }
        continue
      }

      // If calling set_params with non-pipeline params that look like they should be nested
      // (e.g., "clf_alpha" instead of "clf__alpha")
      if (fnText.endsWith('.set_params')) {
        // Check if the param looks like a step_param that's missing double underscore
        const underscoreMatch = paramName.match(/^([a-z]+)_([a-z_]+)$/)
        if (underscoreMatch) {
          const [, possibleStep, possibleParam] = underscoreMatch
          // Common estimator names
          const commonStepNames = new Set(['clf', 'cls', 'reg', 'model', 'pca', 'scaler', 'selector', 'transformer', 'encoder', 'imputer', 'vectorizer', 'tfidf', 'svc', 'svm', 'lr', 'rf', 'gb', 'xgb', 'knn', 'dt', 'nb'])
          if (commonStepNames.has(possibleStep)) {
            return makeViolation(
              this.ruleKey, child, filePath, 'high',
              'Invalid pipeline parameter',
              `Parameter '${paramName}' looks like a pipeline parameter — use '${possibleStep}__${possibleParam}' (double underscore) to set nested parameters.`,
              sourceCode,
              `Change '${paramName}' to '${possibleStep}__${possibleParam}'.`,
            )
          }
        }
      }
    }

    return null
  },
}
