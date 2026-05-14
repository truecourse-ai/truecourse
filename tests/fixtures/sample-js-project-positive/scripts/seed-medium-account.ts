
// Seed script summary output — dev-only seed tooling context where
// console.log is appropriate for reporting seeded data.
declare const team: { url: string; id: string };
console.log(`[SEEDING]: Team URL: ${team.url} (id ${team.id})`);



// Seed script result reporting — dev-only seed tooling context where
// console.log is the correct mechanism for outputting seeded data.
declare const organisation: { url: string; id: string };
console.log(`[SEEDING]: Organisation: ${organisation.url} (id ${organisation.id})`);



declare const nanoid45: () => string;
declare const prisma45: {
  user: {
    findFirst: (opts: unknown) => Promise<{ id: number } | null>;
    create: (opts: unknown) => Promise<{ id: number; email: string }>;
  };
  recipient: { create: (opts: unknown) => Promise<void> };
  $disconnect: () => Promise<void>;
};
declare const seedBlankDocument45: (user: { id: number }, teamId: number, opts: unknown) => Promise<{ id: string }>;
declare const seedUser45: (opts: { name: string; email: string }) => Promise<{ user: { id: number }; team: { id: number } }>;
declare const DocumentStatus45: { DRAFT: string; PENDING: string; COMPLETED: string };
declare const console: { log: (msg: string) => void };

const SEED_EMAIL45 = 'load-test-account@example.com';
const DOC_COUNT45 = 500;
const STATUSES45 = [DocumentStatus45.DRAFT, DocumentStatus45.PENDING, DocumentStatus45.COMPLETED];

export const seedLoadTestDatabase45 = async () => {
  const existingUser = await prisma45.user.findFirst({ where: { email: SEED_EMAIL45 } as unknown });
  if (existingUser) return;

  console.log(`[SEEDING]: Creating load-test account with ${DOC_COUNT45} documents...`);

  const { user, team } = await seedUser45({ name: 'Load Test Account', email: SEED_EMAIL45 });

  const recipientEmails = Array.from({ length: 10 }, (_, i) => `recipient-${i}@loadtest.example.com`);

  for (let i = 0; i < DOC_COUNT45; i++) {
    const status = STATUSES45[i % STATUSES45.length];

    const doc = await seedBlankDocument45(user, team.id, {
      key: `load-${i}`,
      createDocumentOptions: {
        title: `[LOAD] Document ${i} - ${status}`,
        status,
      },
    });

    const recipientCount = (i % 3) + 1;
    for (let r = 0; r < recipientCount; r++) {
      await prisma45.recipient.create({
        data: {
          email: recipientEmails[(i + r) % recipientEmails.length],
          name: `Recipient ${r}`,
          token: nanoid45(),
          envelopeId: doc.id,
        } as unknown,
      });
    }

    if (i % 5 === 0) {
      const ghostUser = await prisma45.user.create({
        data: {
          email: `ghost-${nanoid45()}@loadtest.example.com`,
          name: 'Ghost Sender',
          password: 'hashed-pw',
        } as unknown,
      });

      const ghostDoc = await seedBlankDocument45(ghostUser as unknown as { id: number }, team.id, {
        key: `ghost-${i}`,
        createDocumentOptions: { title: `[GHOST] Document ${i}`, status: DocumentStatus45.PENDING },
      });

      await prisma45.recipient.create({
        data: {
          email: SEED_EMAIL45,
          name: 'Load Test User',
          token: nanoid45(),
          envelopeId: ghostDoc.id,
        } as unknown,
      });
    }
  }

  console.log(`[SEEDING]: Load-test seeding complete`);
  await prisma45.$disconnect();
};
