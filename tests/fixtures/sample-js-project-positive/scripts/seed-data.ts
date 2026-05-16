
declare function seedDatabase(): Promise<void>;

async function runSeeder() {
  await seedDatabase();
  console.log('Seeding complete');
  process.exit(0);
}

runSeeder()
  .then(() => {
    console.log('All seeds applied');
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });



// --- shape db22f4c8ebd2: process.exit(1) in catch block of a CLI script ---
declare function readFileSync(fd: number, encoding: string): string;
declare const process: { exit: (code: number) => never; argv: string[] };

function readStdinContent(): string {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: npx tsx scripts/seed-data.ts <slug>');
    process.exit(1);
  }
  let content = '';
  if (args.length > 1) {
    content = args.slice(1).join(' ');
  } else {
    try {
      content = readFileSync(0, 'utf-8').trim();
    } catch (error) {
      console.error('Error reading from stdin:', error);
      process.exit(1);
    }
  }
  return content;
}



// --- FP shape: await-in-loop in a seed script (sequential writes for ordering) ---
declare const db: {
  recipient: { create(opts: { data: object }): Promise<{ id: string }> };
  document: { findFirst(opts: object): Promise<{ id: string } | null> };
};
declare const seedRecipients: Array<{ email: string; name: string; documentIndex: number }>;
declare const seedDocumentIds: string[];

async function seedDocumentRecipients(): Promise<void> {
  for (const recipient of seedRecipients) {
    await db.recipient.create({
      data: {
        email: recipient.email,
        name: recipient.name,
        documentId: seedDocumentIds[recipient.documentIndex],
      },
    });
  }
}



// --- FP shape: conditional await inside for loop in a seed script ---
declare const db: { recipient: { create(opts: { data: object }): Promise<{ id: string }> } };
declare const BATCH_SIZE = 5;
declare const documentIds: string[];

async function seedConditionalRecipients(): Promise<void> {
  for (let i = 0; i < documentIds.length; i++) {
    if (i % BATCH_SIZE === 0) {
      await db.recipient.create({
        data: { documentId: documentIds[i], email: `user-${i}@example.com`, name: `User ${i}` },
      });
    }
  }
}



// --- FP shape: intra-iteration data dependency in seed — meta.create result used in envelope.create ---
declare const db: {
  documentMeta: { create(opts: { data: object }): Promise<{ id: string }> };
  envelope: { create(opts: { data: object }): Promise<{ id: string }> };
};
declare const seedEntries: Array<{ title: string; ownerId: string }>;

async function seedDocumentsWithMeta(): Promise<void> {
  for (const entry of seedEntries) {
    const meta = await db.documentMeta.create({ data: { title: entry.title } });
    await db.envelope.create({ data: { metaId: meta.id, ownerId: entry.ownerId } });
  }
}



// --- FP shape: conditional prisma.create only when findFirst returns null (intra-iteration conditional dependency) ---
declare const db: {
  user: {
    findFirst(opts: { where: object }): Promise<{ id: string } | null>;
    create(opts: { data: object }): Promise<{ id: string }>;
  };
};
declare const userSeeds: Array<{ email: string; name: string; orgId: string }>;

async function seedOrganisationUsers(): Promise<void> {
  for (const userSeed of userSeeds) {
    const existing = await db.user.findFirst({ where: { email: userSeed.email } });
    if (!existing) {
      await db.user.create({ data: { email: userSeed.email, name: userSeed.name, orgId: userSeed.orgId } });
    }
  }
}



// --- FP shape: inner for loop in seed using outer iteration's doc.id ---
declare const db: { recipient: { create(opts: { data: object }): Promise<{ id: string }> } };
declare const documents: Array<{ id: string; recipientEmails: string[] }>;

async function seedDocumentRecipients2(): Promise<void> {
  for (const doc of documents) {
    for (const email of doc.recipientEmails) {
      await db.recipient.create({ data: { documentId: doc.id, email } });
    }
  }
}



// --- FP shape: multiple sequential awaits in same iter, last depends on first two results ---
declare const db: {
  documentData: { create(opts: { data: object }): Promise<{ id: string }> };
  documentMeta: { create(opts: { data: object }): Promise<{ id: string }> };
  envelope: { create(opts: { data: object }): Promise<{ id: string }> };
};
declare const documentSeeds: Array<{ contentUrl: string; title: string; ownerId: string }>;

async function seedDocumentsChained(): Promise<void> {
  for (const seed of documentSeeds) {
    const documentData = await db.documentData.create({ data: { contentUrl: seed.contentUrl } });
    const documentMeta = await db.documentMeta.create({ data: { title: seed.title } });
    await db.envelope.create({ data: { dataId: documentData.id, metaId: documentMeta.id, ownerId: seed.ownerId } });
  }
}



// --- FP shape: addToOrg uses newUser.id resolved from same-iteration find-or-create ---
declare const db: {
  user: {
    findFirst(opts: { where: object }): Promise<{ id: string } | null>;
    create(opts: { data: object }): Promise<{ id: string }>;
  };
};
declare function addUserToWorkspace(userId: string, workspaceId: string): Promise<void>;
declare const workspaceUserSeeds: Array<{ email: string; name: string; workspaceId: string }>;

async function seedWorkspaceMembers(): Promise<void> {
  for (const seed of workspaceUserSeeds) {
    let user = await db.user.findFirst({ where: { email: seed.email } });
    if (!user) {
      user = await db.user.create({ data: { email: seed.email, name: seed.name } });
    }
    await addUserToWorkspace(user.id, seed.workspaceId);
  }
}



// --- FP shape: incrementing ID used as key in same iteration (intra-iteration dep, monotonic IDs) ---
declare function incrementDocumentCounter(): Promise<number>;
declare const db: { document: { create(opts: { data: object }): Promise<{ id: string }> } };
declare const documentTemplates: Array<{ title: string; ownerId: string }>;

async function seedDocumentsWithSequentialIds(): Promise<void> {
  for (const template of documentTemplates) {
    const documentId = await incrementDocumentCounter();
    await db.document.create({ data: { id: documentId, title: template.title, ownerId: template.ownerId } });
  }
}



// --- FP shape: outer await result used in nested inner loops in same outer iteration ---
declare function seedBlankDocument2(opts: { title: string; ownerId: string }): Promise<{ id: string }>;
declare const db: { recipient: { create(opts: { data: object }): Promise<{ id: string }> } };
declare const documentBatch: Array<{ title: string; ownerId: string; recipients: string[] }>;

async function seedDocumentsWithRecipients(): Promise<void> {
  for (const doc of documentBatch) {
    const created = await seedBlankDocument2({ title: doc.title, ownerId: doc.ownerId });
    for (const email of doc.recipients) {
      await db.recipient.create({ data: { documentId: created.id, email } });
    }
  }
}



// --- FP shape: find-or-create pattern — findFirst result determines whether create is called ---
declare const db: {
  user: {
    findFirst(opts: { where: { email: string } }): Promise<{ id: string } | null>;
    create(opts: { data: { email: string; name: string } }): Promise<{ id: string }>;
  };
};
declare const userEmails: Array<{ email: string; name: string }>;

async function ensureUsersExist(): Promise<void> {
  for (const entry of userEmails) {
    const existing = await db.user.findFirst({ where: { email: entry.email } });
    if (!existing) {
      await db.user.create({ data: { email: entry.email, name: entry.name } });
    }
  }
}



// --- FP shape: createDocumentData result consumed by envelope.create in same iteration (seed) ---
declare function createDocumentData(opts: { contentHash: string }): Promise<{ id: string }>;
declare const db: { envelope: { create(opts: { data: object }): Promise<{ id: string }> } };
declare const seedDocs: Array<{ contentHash: string; title: string; ownerId: string }>;

async function seedDocumentsWithData(): Promise<void> {
  for (const seedDoc of seedDocs) {
    const docData = await createDocumentData({ contentHash: seedDoc.contentHash });
    await db.envelope.create({ data: { dataId: docData.id, title: seedDoc.title, ownerId: seedDoc.ownerId } });
  }
}



// --- void-zero-argument FP shape: toplevel-main-entry (void main() module top-level entry point) ---
declare function connectDatabase(url: string): Promise<void>;
declare function seedTeams(count: number): Promise<void>;
declare function seedUsers(count: number): Promise<void>;
declare function disconnectDatabase(): Promise<void>;

async function main() {
  await connectDatabase(process.env.DATABASE_URL ?? 'postgres://localhost/app');
  await seedTeams(10);
  await seedUsers(50);
  await disconnectDatabase();
  console.log('Seed complete');
}

void main();



// --- void-zero-argument FP shape: toplevel-migrate-legacy (void migrateLegacyData() at module top-level) ---
declare function migrateLegacyServiceAccounts(): Promise<void>;

async function migrateLegacyServiceAccounts_impl(): Promise<void> {
  console.log('Running legacy service account migration...');
  // migration logic
}

void migrateLegacyServiceAccounts_impl();



import fs from 'node:fs';
import path from 'node:path';

const runSeeders = async () => {
  const files = fs.readdirSync(path.join(__dirname, './seed'));

  for (const file of files) {
    const stat = fs.statSync(path.join(__dirname, './seed', file));

    if (stat.isFile()) {
      const mod = require(path.join(__dirname, './seed', file));

      if ('run' in mod && typeof mod.run === 'function') {
        console.log(`[SEED]: Running ${file}`);
        try {
          await mod.run();
        } catch (e) {
          console.error(`[SEED]: Failed for ${file}`, e);
        }
      }
    }
  }
};

runSeeders().catch(console.error);



// shape: ts-pattern .with() async callback in Promise.all().map() delegates to seed function returning a Promise; async for match callback type conformance
declare function seedDraftRecord(sender: unknown, teamId: string, recipients: unknown[]): Promise<void>;
declare function seedPendingRecord(sender: unknown, teamId: string, recipients: unknown[]): Promise<void>;
declare function seedCompletedRecord(sender: unknown, teamId: string, recipients: unknown[]): Promise<void>;
declare const RecordStatus: { DRAFT: 'DRAFT'; PENDING: 'PENDING'; COMPLETED: 'COMPLETED' };
declare const match: (val: unknown) => {
  with(pattern: unknown, cb: () => Promise<void>): {
    with(pattern: unknown, cb: () => Promise<void>): {
      with(pattern: unknown, cb: () => Promise<void>): { exhaustive(): Promise<void> }
    }
  }
};

type RecordToSeed = { sender: unknown; teamId: string; recipients: unknown[]; status: 'DRAFT' | 'PENDING' | 'COMPLETED' };

const seedRecords = async (records: RecordToSeed[]) => {
  await Promise.all(
    // eslint-disable-next-line @typescript-eslint/require-await
    records.map(async (record) =>
      match(record.status)
        .with(RecordStatus.DRAFT, async () =>
          seedDraftRecord(record.sender, record.teamId, record.recipients),
        )
        .with(RecordStatus.PENDING, async () =>
          seedPendingRecord(record.sender, record.teamId, record.recipients),
        )
        .with(RecordStatus.COMPLETED, async () =>
          seedCompletedRecord(record.sender, record.teamId, record.recipients),
        )
        .exhaustive(),
    ),
  );
};



// shape: ts-pattern .with() async callback delegates to seedDraftRecord returning a Promise; async for match callback type conformance
declare function seedDraftEntry(sender: unknown, teamId: string, recipients: unknown[]): Promise<void>;
declare function seedPendingEntry(sender: unknown, teamId: string, recipients: unknown[]): Promise<void>;
declare const EntryStatus: { DRAFT: 'DRAFT'; PENDING: 'PENDING' };
declare const matchEntry: (val: unknown) => {
  with(pattern: unknown, cb: () => Promise<void>): {
    with(pattern: unknown, cb: () => Promise<void>): { exhaustive(): Promise<void> }
  }
};

type EntryToSeed = { sender: unknown; teamId: string; recipients: unknown[]; status: 'DRAFT' | 'PENDING' };

const seedEntries = async (entries: EntryToSeed[]) => {
  await Promise.all(
    // eslint-disable-next-line @typescript-eslint/require-await
    entries.map(async (entry) =>
      matchEntry(entry.status)
        .with(EntryStatus.DRAFT, async () =>
          seedDraftEntry(entry.sender, entry.teamId, entry.recipients),
        )
        .with(EntryStatus.PENDING, async () =>
          seedPendingEntry(entry.sender, entry.teamId, entry.recipients),
        )
        .exhaustive(),
    ),
  );
};



// Pass-through logging: logs static string then passes e to console.error as argument
async function seedInitialData(): Promise<void> {
  try {
    await populateSeedRecords();
    console.log('Seed completed successfully.');
  } catch (e) {
    console.error('Seeding failed.');
    console.error(e);
    process.exit(1);
  }
}

declare function populateSeedRecords(): Promise<void>;


declare function seedUsers(): Promise<void>;
declare function seedOrganisations(): Promise<void>;

async function seedDatabase() {
  await seedUsers();
  await seedOrganisations();
  console.log('Database seeded successfully');
}

seedDatabase()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Seeding failed:', err);
    process.exit(1);
  });



declare function populateTemplates(): Promise<void>;

async function seedTemplates() {
  await populateTemplates();
}

seedTemplates()
  .then(() => {
    console.log('Templates populated');
  })
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });



// Seed helper: generate a short pseudo-random access token for test recipients
declare const prisma: { envelope: { create: (opts: any) => Promise<any> } };
declare const prefixedId: (prefix: string) => string;
declare const DocumentSource: { DOCUMENT: string };
declare const SendStatus: { NOT_SENT: string };
declare const SigningStatus: { NOT_SIGNED: string };
declare const ReadStatus: { NOT_OPENED: string };
declare const RecipientRole: { SIGNER: string };

export async function seedEnvelopeWithRecipient(userId: string, teamId: string) {
  return prisma.envelope.create({
    data: {
      id: prefixedId('envelope'),
      source: DocumentSource.DOCUMENT,
      title: 'Sample Seed Envelope',
      userId,
      teamId,
      recipients: {
        create: {
          email: 'test.recipient@example.com',
          name: 'Test Recipient',
          token: Math.random().toString().slice(2, 7),
          sendStatus: SendStatus.NOT_SENT,
          signingStatus: SigningStatus.NOT_SIGNED,
          readStatus: ReadStatus.NOT_OPENED,
          role: RecipientRole.SIGNER,
        },
      },
    },
  });
}



// Seed helper: generate short alphanumeric tokens for test documents using Math.random
declare const db: { document: { create: (opts: any) => Promise<any> } };
declare const createDocumentData: (opts: any) => Promise<{ id: string }>;
declare const examplePdf: Buffer;
declare const adminUser: { user: { id: string; name: string | null; email: string } };
declare const exampleUser: { user: { id: string }; team: { id: string } };

export async function seedDocumentWithRecipient(index: number) {
  const documentData = await createDocumentData({ documentData: examplePdf });

  return db.document.create({
    data: {
      title: `Sample Document ${index}`,
      documentDataId: documentData.id,
      userId: exampleUser.user.id,
      teamId: exampleUser.team.id,
      recipients: {
        create: {
          name: String(adminUser.user.name),
          email: adminUser.user.email,
          token: Math.random().toString(36).slice(2, 9),
        },
      },
    },
  });
}



// Seed data enum comparison — comparing field.type === 'SIGNATURE' for insert flag
interface SeedField { type: string; customText: string; signature?: string; }

export function computeInsertedFlag(field: SeedField, insertFields: boolean): boolean {
  return insertFields && (Boolean(field.customText) || field.type === 'SIGNATURE');
}



// Seed data: comparing field.type === 'SIGNATURE' to derive insert flag — enum comparison, not secret
interface SeedFormField { type: string; customText?: string; fieldMeta?: { readOnly?: boolean }; }

export function seedInsertedFlag(field: SeedFormField, insertFields: boolean): boolean {
  return insertFields && ((!field.fieldMeta?.readOnly && Boolean(field.customText)) || field.type === 'SIGNATURE');
}


// Entity type prefix string passed to prefixedId helper in seed data — single-use type identifier
declare function prefixedId(entityType: string): string;
declare const seedDb: {
  report: {
    create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
  };
};

export async function seedReportRecord(workspaceId: number, ownerId: number) {
  return seedDb.report.create({
    data: {
      id: prefixedId('report'),
      type: 'TEMPLATE',
      workspaceId,
      ownerId,
      title: '[SEED] Sample Report Template',
    },
  });
}



// Standard promise .catch() error handler on a CLI entry-point — no type mismatch
async function runSeedMigration(): Promise<void> {
  console.log('Starting seed migration...');
  console.log('Seed migration complete.');
}

runSeedMigration().catch((error) => {
  console.error(error);
  process.exit(1);
});



// process.exit(1) — process.exit accepts a number exit code; 1 is valid. Standard Node.js script error exit.
declare const process28: { exit: (code: number) => never; env: Record<string, string | undefined>; argv: string[] };

function requireEnvVarForScript(name: string): string {
  const value = process28.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process28.exit(1);
  }
  return value;
}

function validateScriptArgs(minArgs: number): string[] {
  const args = process28.argv.slice(2);
  if (args.length < minArgs) {
    console.error(`Usage: npx tsx scripts/seed-data.ts <arg1> [arg2...]`);
    process28.exit(1);
  }
  return args;
}

