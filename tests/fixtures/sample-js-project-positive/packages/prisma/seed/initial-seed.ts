declare const prisma: { user: { upsert: (args: unknown) => Promise<unknown> }; organisation: { upsert: (args: unknown) => Promise<unknown> }; team: { upsert: (args: unknown) => Promise<unknown> }; organisationMember: { upsert: (args: unknown) => Promise<unknown> }; $disconnect: () => Promise<void> };
declare const hashPassword: (password: string) => Promise<string>;
declare const logger: { info: (msg: string) => void; error: (msg: string, err?: unknown) => void };

import { z } from 'zod';

const SeedConfigSchema = z.object({
  adminEmail: z.string().email().default('admin@example.com'),
  adminPassword: z.string().min(8).default('Admin1234!'),
  orgName: z.string().default('Acme Organisation'),
  teamName: z.string().default('Engineering'),
});

async function seedDatabase(rawConfig: unknown = {}) {
  const config = SeedConfigSchema.parse(rawConfig);

  logger.info('Starting initial database seed...');

  const passwordHash = await hashPassword(config.adminPassword);

  const adminUser = await prisma.user.upsert({
    where: { email: config.adminEmail },
    update: {},
    create: {
      email: config.adminEmail,
      name: 'Admin User',
      passwordHash,
      isEmailVerified: true,
    },
  });

  logger.info('Admin user ready');

  const org = await prisma.organisation.upsert({
    where: { slug: 'acme-organisation' },
    update: {},
    create: {
      name: config.orgName,
      slug: 'acme-organisation',
      plan: 'FREE',
    },
  });

  logger.info('Organisation ready');

  await prisma.organisationMember.upsert({
    where: { organisationId_userId: { organisationId: (org as { id: string }).id, userId: (adminUser as { id: string }).id } },
    update: {},
    create: {
      organisationId: (org as { id: string }).id,
      userId: (adminUser as { id: string }).id,
      role: 'ADMIN',
    },
  });

  await prisma.team.upsert({
    where: { url: 'engineering' },
    update: {},
    create: {
      name: config.teamName,
      url: 'engineering',
      organisationId: (org as { id: string }).id,
    },
  });

  logger.info('Seed completed successfully.');
}

seedDatabase()
  .catch((err) => { logger.error('Seed failed', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
