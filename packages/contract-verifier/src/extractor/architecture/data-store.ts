import type { ArchitectureDetector } from './types.js';
import { detectByChoiceSpecs, type ChoiceSpec } from './shared/detect.js';

const PRISMA_SCHEMA = ['prisma/schema.prisma', 'schema.prisma'];

const SPECS: ChoiceSpec[] = [
  {
    value: 'postgres',
    packages: ['pg', 'postgres', 'node-postgres', '@prisma/client', 'psycopg2', 'psycopg2-binary', 'psycopg', 'asyncpg', 'pg8000'],
    imports: ['pg', 'postgres', 'psycopg2', 'psycopg', 'asyncpg'],
    configContent: { globs: PRISMA_SCHEMA, pattern: /provider\s*=\s*"postgresql"/ },
  },
  {
    value: 'mysql',
    packages: ['mysql', 'mysql2', 'pymysql', 'mysqlclient', 'aiomysql', 'mysql-connector-python'],
    imports: ['mysql', 'mysql2', 'pymysql', 'aiomysql'],
    configContent: { globs: PRISMA_SCHEMA, pattern: /provider\s*=\s*"mysql"/ },
  },
  {
    value: 'mongodb',
    packages: ['mongoose', 'mongodb', 'pymongo', 'mongoengine', 'motor', 'beanie'],
    imports: ['mongoose', 'mongodb', 'pymongo', 'mongoengine', 'motor'],
    configContent: { globs: PRISMA_SCHEMA, pattern: /provider\s*=\s*"mongodb"/ },
  },
  {
    value: 'sqlite',
    packages: ['better-sqlite3', 'sqlite', 'sqlite3', 'aiosqlite'],
    configContent: { globs: PRISMA_SCHEMA, pattern: /provider\s*=\s*"sqlite"/ },
  },
  { value: 'dynamodb', packages: ['@aws-sdk/client-dynamodb', 'dynamoose'] },
  { value: 'redis-primary', packages: ['ioredis', 'redis', '@upstash/redis'] },
  { value: 'bigquery', packages: ['@google-cloud/bigquery'] },
  { value: 'cassandra', packages: ['cassandra-driver'] },
  { value: 'cockroachdb', configContent: { globs: PRISMA_SCHEMA, pattern: /provider\s*=\s*"cockroachdb"/ } },
];

export const dataStoreDetector: ArchitectureDetector = {
  category: 'data-store',
  alternatives: SPECS.map((s) => s.value),
  detect: (scan, scope) => detectByChoiceSpecs('data-store', scan, SPECS, { scope }),
};
