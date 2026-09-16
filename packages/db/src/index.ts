export * from './schema/index.js';
export {
  createDb,
  watchClientErrors,
  MIGRATIONS_DIR,
  type Db,
  type DbHandle,
  type CreateDbOptions,
  Pool,
  type PoolClient,
} from './db.js';
