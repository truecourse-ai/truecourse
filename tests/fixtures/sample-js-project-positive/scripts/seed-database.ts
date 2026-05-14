
// Database seed script — console.log is appropriate for user-visible
// progress reporting in dev tooling.
declare function runSeedFile(file: string): Promise<void>;
declare const seedFiles: string[];

const seedDatabase = async () => {
  for (const file of seedFiles) {
    try {
      await runSeedFile(file);
    } catch (e) {
      console.log(`[SEEDING]: Seed failed for ${file}`);
      console.error(e);
    }
  }
};

seedDatabase()
  .then(() => {
    console.log('Database seeded successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });



// Seed script uses console.log for progress output — appropriate in
// dev/setup tooling.
declare const seedFile: string;
console.log(`[SEEDING]: ${seedFile}`);



// Seed script logs failed file to console — dev tooling context where
// console.log is appropriate for progress reporting.
declare const failedFile: string;
console.log(`[SEEDING]: Seed failed for ${failedFile}`);



// [unknown-catch-variable] catch(e) — console.error(e) value pass; fixed log message follows
declare function seedInitialData(): Promise<void>;
declare function disconnectDb(): Promise<void>;

async function runDatabaseSeed(): Promise<void> {
  try {
    await seedInitialData();
    console.log('Database seeded successfully');
  } catch (e) {
    console.error(e);
    console.log('Seeding failed — check logs above');
  } finally {
    await disconnectDb();
  }
}

runDatabaseSeed();



// fs.readFileSync inside a seed helper function — CLI seed script, no HTTP handler — FP shape 236762de83ba
declare const prisma: any;

export async function seedTestDocuments({
  userId,
  teamId,
  recipientEmail,
}: {
  userId: number;
  teamId: number;
  recipientEmail: string;
}) {
  const pdfContent = fs
    .readFileSync(path.join(__dirname, '../assets/test-document.pdf'))
    .toString('base64');

  const docData = await prisma.documentData.create({
    data: { type: 'BYTES_64', data: pdfContent, initialData: pdfContent },
  });

  await prisma.envelope.create({
    data: {
      title: 'Test Document',
      documentDataId: docData.id,
      userId,
      teamId,
    },
  });
}



// fs.readFileSync in seedDatabase() entry point — CLI script, no request handler — FP shape 2738d3eaa871
export async function seedDatabase() {
  const examplePdf = fs
    .readFileSync(path.join(__dirname, '../assets/example.pdf'))
    .toString('base64');

  const existingUser = await prisma.user.findFirst({
    where: { email: 'seed@example.com' },
  });

  if (existingUser) {
    return;
  }

  await prisma.user.create({
    data: {
      email: 'seed@example.com',
      name: 'Seed User',
      password: 'hashed-password',
    },
  });
}



// fs.readFileSync inside a nested seeding helper in same seed file — FP shape 46120433fb7d
export async function seedDocumentWithFields({
  userId,
  teamId,
  recipientEmail,
  recipientName,
}: {
  userId: number;
  teamId: number;
  recipientEmail: string;
  recipientName: string;
}) {
  const fieldsPdf = fs
    .readFileSync(path.join(__dirname, '../assets/fields-test.pdf'))
    .toString('base64');

  const fieldMetaPdf = fs
    .readFileSync(path.join(__dirname, '../assets/field-meta.pdf'))
    .toString('base64');

  const docData = await prisma.documentData.create({
    data: { type: 'BYTES_64', data: fieldsPdf, initialData: fieldsPdf },
  });

  return docData;
}



// fs.statSync in CLI seed runner — process exits after seeding, no event loop — FP shape 5f2c7fb9e69a
async function runSeedScripts() {
  const files = fs.readdirSync(path.join(__dirname, './seeds'));

  for (const file of files) {
    const stat = fs.statSync(path.join(__dirname, './seeds', file));

    if (stat.isFile() && file.endsWith('.ts')) {
      console.log(`[SEED]: Running ${file}`);
    }
  }
}

runSeedScripts()
  .then(() => {
    console.log('[SEED]: Done');
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });



// fs.readFileSync in another seeding helper — database init only, not a request handler — FP shape 79e112766d62
export async function seedDocumentWithOverflow({
  userId,
  teamId,
  recipientEmail,
  recipientName,
}: {
  userId: number;
  teamId: number;
  recipientEmail: string;
  recipientName: string;
}) {
  const overflowPdf = fs
    .readFileSync(path.join(__dirname, '../assets/overflow-test.pdf'))
    .toString('base64');

  const docData = await prisma.documentData.create({
    data: { type: 'BYTES_64', data: overflowPdf, initialData: overflowPdf },
  });

  await prisma.envelope.create({
    data: {
      title: 'Overflow Test',
      documentDataId: docData.id,
      userId,
      teamId,
    },
  });
}



// fs.readdirSync in seedDatabase() CLI entry point — invoked via process.exit(), no HTTP loop — FP shape cf7f727f452c
async function seedAllModules() {
  const files = fs.readdirSync(path.join(__dirname, './seed'));

  for (const file of files) {
    const mod = require(path.join(__dirname, './seed', file));

    if ('seedDatabase' in mod && typeof mod.seedDatabase === 'function') {
      console.log(`[SEEDING]: ${file}`);
      try {
        await mod.seedDatabase();
      } catch (e) {
        console.error(`[SEEDING]: Failed: ${file}`, e);
      }
    }
  }
}

seedAllModules()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));



// require() in standalone async seed script — no HTTP handler or server — FP shape 98a7047fb68c
async function runAllSeedModules() {
  const seedFiles = fs.readdirSync(path.join(__dirname, './seed'));

  for (const seedFile of seedFiles) {
    const stat = fs.statSync(path.join(__dirname, './seed', seedFile));

    if (stat.isFile()) {
      const mod = require(path.join(__dirname, './seed', seedFile));

      if ('seedDatabase' in mod && typeof mod.seedDatabase === 'function') {
        console.log(`[SEEDING]: ${seedFile}`);
        try {
          await mod.seedDatabase();
        } catch (e) {
          console.error(`[SEEDING]: Seed failed for ${seedFile}`);
          console.error(e);
        }
      }
    }
  }
}

runAllSeedModules()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));


// Seed script generating test data — Math.random() acceptable for non-production seed tokens
declare function createTestEnvelope(opts: { token: string; title: string }): Promise<{ id: string }>;

async function seedTestEnvelopes() {
  const envelopes = [
    { title: 'Sample NDA' },
    { title: 'Sample Employment Agreement' },
    { title: 'Sample Service Contract' },
  ];

  for (const env of envelopes) {
    await createTestEnvelope({
      token: Math.random().toString(36).slice(2, 9),
      title: env.title,
    });
  }
}

void seedTestEnvelopes();
