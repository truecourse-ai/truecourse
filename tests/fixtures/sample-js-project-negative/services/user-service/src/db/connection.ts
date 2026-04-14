import { PrismaClient } from '@prisma/client';

let client: PrismaClient | null = null;

export async function connectDatabase(): Promise<PrismaClient> {
  if (!client) {
    client = new PrismaClient();
    await client.$connect();
  }
  return client;
}

// VIOLATION: architecture/deterministic/dead-method
// VIOLATION: architecture/deterministic/unused-export
export async function disconnectDatabase(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}
