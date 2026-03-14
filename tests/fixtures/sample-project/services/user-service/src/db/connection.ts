import { PrismaClient } from '@prisma/client';

let client: PrismaClient | null = null;

export async function connectDatabase(): Promise<PrismaClient> {
  if (!client) {
    client = new PrismaClient();
    await client.$connect();
  }
  return client;
}

export async function disconnectDatabase(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}
