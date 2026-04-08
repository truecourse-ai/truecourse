import { PrismaClient } from '@prisma/client';

const client: PrismaClient = new PrismaClient();

export async function connectDatabase(): Promise<PrismaClient> {
  await client.$connect();
  return client;
}

export async function disconnectDatabase(): Promise<void> {
  await client.$disconnect();
}
