import type { ArchitectureDetector } from './types.js';
import { detectByChoiceSpecs, type ChoiceSpec } from './shared/detect.js';

const PRISMA_SCHEMA = ['prisma/schema.prisma', 'schema.prisma'];

const SPECS: ChoiceSpec[] = [
  {
    value: 'postgres',
    packages: ['pg', 'postgres', 'node-postgres', '@prisma/client'],
    imports: ['pg', 'postgres'],
    configContent: { globs: PRISMA_SCHEMA, pattern: /provider\s*=\s*"postgresql"/ },
  },
  {
    value: 'mysql',
    packages: ['mysql', 'mysql2'],
    imports: ['mysql', 'mysql2'],
    configContent: { globs: PRISMA_SCHEMA, pattern: /provider\s*=\s*"mysql"/ },
  },
  {
    value: 'mongodb',
    packages: ['mongoose', 'mongodb'],
    imports: ['mongoose', 'mongodb'],
    configContent: { globs: PRISMA_SCHEMA, pattern: /provider\s*=\s*"mongodb"/ },
  },
  {
    value: 'sqlite',
    packages: ['better-sqlite3', 'sqlite', 'sqlite3'],
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
