import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Common ML estimator/optimizer classes that have important hyperparameters
const ML_CLASSES_WITH_REQUIRED_PARAMS: Record<string, string[]> = {
  // sklearn
  'RandomForestClassifier': ['n_estimators', 'max_depth'],
  'RandomForestRegressor': ['n_estimators', 'max_depth'],
  'GradientBoostingClassifier': ['n_estimators', 'learning_rate', 'max_depth'],
  'GradientBoostingRegressor': ['n_estimators', 'learning_rate', 'max_depth'],
  'SVC': ['C', 'kernel'],
  'SVR': ['C', 'kernel'],
  'KNeighborsClassifier': ['n_neighbors'],
  'KNeighborsRegressor': ['n_neighbors'],
  // torch optimizers
  'SGD': ['lr'],
  'Adam': ['lr'],
  'AdamW': ['lr'],
  'RMSprop': ['lr'],
}

export const pythonMlMissingHyperparametersVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/ml-missing-hyperparameters',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    // Get the class name (last segment of attribute chain or identifier)
    let className: string
    if (fn.type === 'identifier') {
      className = fn.text
    } else if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      className = attr?.text ?? ''
    } else {
      return null
    }

    const requiredParams = ML_CLASSES_WITH_REQUIRED_PARAMS[className]
    if (!requiredParams) return null

    const args = node.childForFieldName('arguments')
    if (!args) {
      // No args at all — all are missing
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Missing ML hyperparameters',
        `\`${className}()\` called with no arguments — important hyperparameters (${requiredParams.map((p) => `\`${p}\``).join(', ')}) are relying on defaults which may not be optimal.`,
        sourceCode,
        `Specify hyperparameters explicitly: \`${className}(${requiredParams.map((p) => `${p}=...`).join(', ')})\`.`,
      )
    }

    const kwargs = args.namedChildren
      .filter((c) => c.type === 'keyword_argument')
      .map((c) => c.childForFieldName('name')?.text)

    const missing = requiredParams.filter((p) => !kwargs.includes(p))
    if (missing.length === 0) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Missing ML hyperparameters',
      `\`${className}()\` missing explicit hyperparameters: ${missing.map((p) => `\`${p}\``).join(', ')} — defaults may not be optimal for your use case.`,
      sourceCode,
      `Add explicit hyperparameters: ${missing.map((p) => `\`${p}=...\``).join(', ')}.`,
    )
  },
}
