import type { CodeRuleVisitor } from '../../../types.js'

import { pythonAwsIamAllResourcesVisitor } from './aws-iam-all-resources.js'

export { pythonAwsIamAllResourcesVisitor }

export const SECURITY_PYTHON_VISITORS: CodeRuleVisitor[] = [
  pythonAwsIamAllResourcesVisitor,
]
