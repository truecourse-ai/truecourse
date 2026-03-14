import type { DatabaseType } from '@truecourse/shared'

/**
 * Maps npm package names to the database type they connect to.
 * Used to detect which databases a service uses from its imports.
 */
export const DATABASE_IMPORT_MAP: Record<string, { type: DatabaseType; driver: string }> = {
  // PostgreSQL ORMs & drivers
  '@prisma/client': { type: 'postgres', driver: 'prisma' },
  'prisma': { type: 'postgres', driver: 'prisma' },
  'typeorm': { type: 'postgres', driver: 'typeorm' },
  'drizzle-orm': { type: 'postgres', driver: 'drizzle' },
  'drizzle-orm/pg-core': { type: 'postgres', driver: 'drizzle' },
  'sequelize': { type: 'postgres', driver: 'sequelize' },
  'knex': { type: 'postgres', driver: 'knex' },
  'objection': { type: 'postgres', driver: 'objection' },
  'kysely': { type: 'postgres', driver: 'kysely' },
  'pg': { type: 'postgres', driver: 'pg' },
  'pg-promise': { type: 'postgres', driver: 'pg-promise' },
  'postgres': { type: 'postgres', driver: 'postgres' },
  'slonik': { type: 'postgres', driver: 'slonik' },

  // MySQL drivers
  'mysql': { type: 'mysql', driver: 'mysql' },
  'mysql2': { type: 'mysql', driver: 'mysql2' },
  'drizzle-orm/mysql-core': { type: 'mysql', driver: 'drizzle' },

  // SQLite drivers
  'better-sqlite3': { type: 'sqlite', driver: 'better-sqlite3' },
  'sqlite3': { type: 'sqlite', driver: 'sqlite3' },
  'drizzle-orm/sqlite-core': { type: 'sqlite', driver: 'drizzle' },

  // MongoDB
  'mongodb': { type: 'mongodb', driver: 'mongodb' },
  'mongoose': { type: 'mongodb', driver: 'mongoose' },
  '@typegoose/typegoose': { type: 'mongodb', driver: 'typegoose' },

  // Redis
  'redis': { type: 'redis', driver: 'redis' },
  'ioredis': { type: 'redis', driver: 'ioredis' },
  '@redis/client': { type: 'redis', driver: 'redis' },
}

/**
 * Maps environment variable names to database types.
 */
export const CONNECTION_ENV_VARS: Record<string, DatabaseType> = {
  'DATABASE_URL': 'postgres',
  'POSTGRES_URL': 'postgres',
  'PG_CONNECTION_STRING': 'postgres',
  'PGHOST': 'postgres',
  'REDIS_URL': 'redis',
  'REDIS_HOST': 'redis',
  'MONGODB_URI': 'mongodb',
  'MONGO_URL': 'mongodb',
  'MONGO_URI': 'mongodb',
  'MYSQL_URL': 'mysql',
  'MYSQL_HOST': 'mysql',
}

/**
 * Maps Docker image names to database types.
 */
export const DOCKER_IMAGE_MAP: Record<string, DatabaseType> = {
  'postgres': 'postgres',
  'redis': 'redis',
  'mongo': 'mongodb',
  'mongodb': 'mongodb',
  'mysql': 'mysql',
  'mariadb': 'mysql',
  'sqlite': 'sqlite',
}

/**
 * Schema file patterns for each ORM/framework.
 */
export const SCHEMA_FILE_PATTERNS = {
  prisma: ['**/prisma/schema.prisma', '**/schema.prisma'],
  drizzle: ['**/drizzle/**/*.ts', '**/db/schema*.ts', '**/schema/*.ts'],
  mongoose: ['**/models/**/*.ts', '**/models/**/*.js'],
}
