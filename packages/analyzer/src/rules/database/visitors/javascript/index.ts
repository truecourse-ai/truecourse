import type { CodeRuleVisitor } from '../../../types.js'

export { unsafeDeleteWithoutWhereVisitor } from './unsafe-delete-without-where.js'
export { selectStarVisitor } from './select-star.js'
export { missingMigrationVisitor } from './missing-migration.js'
export { connectionNotReleasedVisitor } from './connection-not-released.js'
export { ormLazyLoadInLoopVisitor } from './orm-lazy-load-in-loop.js'
export { missingTransactionVisitor } from './missing-transaction.js'
export { unvalidatedExternalDataVisitor } from './unvalidated-external-data.js'
export { missingUniqueConstraintVisitor } from './missing-unique-constraint.js'

import { unsafeDeleteWithoutWhereVisitor } from './unsafe-delete-without-where.js'
import { selectStarVisitor } from './select-star.js'
import { missingMigrationVisitor } from './missing-migration.js'
import { connectionNotReleasedVisitor } from './connection-not-released.js'
import { ormLazyLoadInLoopVisitor } from './orm-lazy-load-in-loop.js'
import { missingTransactionVisitor } from './missing-transaction.js'
import { unvalidatedExternalDataVisitor } from './unvalidated-external-data.js'
import { missingUniqueConstraintVisitor } from './missing-unique-constraint.js'

export const DATABASE_JS_VISITORS: CodeRuleVisitor[] = [
  unsafeDeleteWithoutWhereVisitor,
  selectStarVisitor,
  missingMigrationVisitor,
  connectionNotReleasedVisitor,
  ormLazyLoadInLoopVisitor,
  missingTransactionVisitor,
  unvalidatedExternalDataVisitor,
  missingUniqueConstraintVisitor,
]
