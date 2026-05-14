
declare function createPrismaClient(): unknown;
declare function readReplicas(opts: { url: string[] }): unknown;
declare const prisma: { $extends: (plugin: unknown) => unknown };

function buildDatabaseClient() {
  if (!process.env.DATABASE_REPLICA_URLS) {
    return prisma;
  }

  const replicaUrls = process.env.DATABASE_REPLICA_URLS.split(',').map((url) => url.trim());

  return prisma.$extends(
    readReplicas({
      url: replicaUrls,
    }),
  );
}
