import type { CodeRuleVisitor } from '../../../types.js'

export { pythonUnsafeDeleteWithoutWhereVisitor } from './unsafe-delete-without-where.js'
export { pythonSelectStarVisitor } from './select-star.js'
export { pythonMissingMigrationVisitor } from './missing-migration.js'
export { pythonConnectionNotReleasedVisitor } from './connection-not-released.js'
export { pythonOrmLazyLoadInLoopVisitor } from './orm-lazy-load-in-loop.js'
export { pythonMissingTransactionVisitor } from './missing-transaction.js'
export { pythonUnvalidatedExternalDataVisitor } from './unvalidated-external-data.js'
export { pythonMissingUniqueConstraintVisitor } from './missing-unique-constraint.js'

import { pythonUnsafeDeleteWithoutWhereVisitor } from './unsafe-delete-without-where.js'
import { pythonSelectStarVisitor } from './select-star.js'
import { pythonMissingMigrationVisitor } from './missing-migration.js'
import { pythonConnectionNotReleasedVisitor } from './connection-not-released.js'
import { pythonOrmLazyLoadInLoopVisitor } from './orm-lazy-load-in-loop.js'
import { pythonMissingTransactionVisitor } from './missing-transaction.js'
import { pythonUnvalidatedExternalDataVisitor } from './unvalidated-external-data.js'
import { pythonMissingUniqueConstraintVisitor } from './missing-unique-constraint.js'

export const DATABASE_PYTHON_VISITORS: CodeRuleVisitor[] = [
  pythonUnsafeDeleteWithoutWhereVisitor,
  pythonSelectStarVisitor,
  pythonMissingMigrationVisitor,
  pythonConnectionNotReleasedVisitor,
  pythonOrmLazyLoadInLoopVisitor,
  pythonMissingTransactionVisitor,
  pythonUnvalidatedExternalDataVisitor,
  pythonMissingUniqueConstraintVisitor,
]
