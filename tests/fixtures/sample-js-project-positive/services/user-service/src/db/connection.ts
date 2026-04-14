import { PrismaClient } from '@prisma/client';

const client: PrismaClient = new PrismaClient();

export async function connectDatabase(): Promise<PrismaClient> {
  await client.$connect();
  return client;
}

export async function disconnectDatabase(): Promise<void> {
  await client.$disconnect();
}

// Standalone getClient() function — not a pool.getClient() method call, should not be flagged
function getClient(): PrismaClient {
  return client;
}
export function getDb(): PrismaClient {
  return getClient();
}
