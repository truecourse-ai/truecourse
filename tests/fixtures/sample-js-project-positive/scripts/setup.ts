/**
 * Setup script — process.exit() is allowed in scripts/ directory.
 */
export function runSetup(): never {
  process.exit(0);
}



// FP shape 04d3d17ddffc: path.join with string arguments — no type mismatch
declare const path: { join: (...segments: string[]) => string };
declare const __dirname: string;

const logoPath = path.join(__dirname, '../../../assets/', 'brand_logo.png');
const configPath = path.join(__dirname, '../../config/', 'default.json');



// FP shape 05c21af456d2: async map in seed script with ORM create — no type mismatch
interface SeedField { name: string; fieldType: string; required: boolean; }
declare const SEED_FIELD_DEFINITIONS: SeedField[];
interface TxClient { field: { create: (opts: object) => Promise<unknown> } }
declare const db: { $transaction: (fn: (tx: TxClient) => Promise<unknown>) => Promise<unknown> };
declare const formId: string;

async function seedFormFields() {
  await db.$transaction(async (tx) => {
    await Promise.all(
      SEED_FIELD_DEFINITIONS.map(async (field) => {
        await tx.field.create({
          data: { formId, name: field.name, fieldType: field.fieldType, required: field.required },
        });
      })
    );
  });
}



// FP shape 069aeec08f1f: Array.from({ length }).map index-based generation — no type mismatch
declare const createSampleRecords: number;

const sampleUsers = Array.from({ length: createSampleRecords }).map((_, i) => ({
  name: `Sample User ${i + 1}`,
  email: `user${i + 1}@example.com`,
  role: i === 0 ? 'admin' : 'member',
}));



// FP shape: promise.then(() => { sideEffect(); process.exit(0); }) — void then callback
declare function runMigrations(): Promise<void>;

runMigrations()
  .then(() => {
    console.log('Migrations completed successfully');
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });



// FP: SEED_ITEMS.map(async (item) => { await db.item.create(...) }) — standard async map for seeding
interface SeedItem { name: string; type: string; order: number; }
const SEED_ITEMS: SeedItem[] = [
  { name: 'Alpha', type: 'primary', order: 1 },
  { name: 'Beta', type: 'secondary', order: 2 },
];
declare const db: { item: { create: (args: { data: SeedItem }) => Promise<SeedItem> } };

async function seedItems() {
  await Promise.all(
    SEED_ITEMS.map(async (item) => {
      await db.item.create({ data: item });
    }),
  );
}



// FP: fs.readFileSync(path.join(...), 'base64') — passing 'base64' encoding is correct fs.readFileSync API
declare const fs: { readFileSync: (path: string, encoding: BufferEncoding) => string };
declare const path: { join: (...parts: string[]) => string };
declare const __dirname: string;

const pdfBase64 = fs.readFileSync(
  path.join(__dirname, '..', 'fixtures', 'sample.pdf'),
  'base64',
);

const jsonData = fs.readFileSync(
  path.join(__dirname, '..', 'fixtures', 'config.json'),
  'utf-8',
);



// FP: fs.readFileSync(path.join(__dirname, '...')) — path.join returns string, readFileSync accepts string
declare const fs: { readFileSync: (path: string) => Buffer };
declare const path: { join: (...parts: string[]) => string };
declare const __dirname: string;

const pdfBuffer = fs.readFileSync(
  path.join(__dirname, '..', 'test-assets', 'sample-document.pdf'),
);

const templateBuffer = fs.readFileSync(
  path.join(__dirname, '..', 'test-assets', 'template.pdf'),
);



// FP: forEach calling a function with path object — standard dotenv usage
declare const dotenv: { config: (opts: { path: string }) => void };
declare const path: { join: (...args: string[]) => string };
declare const __dirname: string;

const ENV_FILES = ['.env', '.env.local', '.env.development'];
ENV_FILES.forEach((file) => {
  dotenv.config({
    path: path.join(__dirname, `../../${file}`),
  });
});



// Promise.all with an array of typed async seed calls — no argument type mismatch.
declare function createTemplate(opts: { title: string; workspaceId: string }): Promise<{ id: string }>;
declare function createDirectTemplate(opts: { title: string; workspaceId: string }): Promise<{ id: string }>;
declare function createOverflowDoc(opts: { workspaceId: string; authorName: string; authorEmail: string }): Promise<{ id: string }>;

async function seedWorkspaceContent(
  workspace: { id: string },
  author: { name: string; email: string },
): Promise<void> {
  await Promise.all([
    createTemplate({
      title: 'Onboarding Contract',
      workspaceId: workspace.id,
    }),
    createDirectTemplate({
      title: 'Direct Onboarding',
      workspaceId: workspace.id,
    }),
    createOverflowDoc({
      workspaceId: workspace.id,
      authorName: author.name,
      authorEmail: author.email,
    }),
  ]);
}


// path.join(require.resolve(pkg), '..') — standard Node.js pattern for resolving package dirs.
declare const path: { join(...parts: string[]): string };
declare function requireResolve(id: string): string;

function resolvePackageDir(packageName: string): string {
  return path.join(requireResolve(packageName), '..');
}


// Array.from({ length: N }, (_, i) => ...) — standard Array.from with map function and index.
interface SeedUser { email: string; name: string; index: number; }

function generateSeedUsers(count: number): SeedUser[] {
  return Array.from({ length: count }, (_, i) => ({
    email: `user${i + 1}@example.com`,
    name: `Test User ${i + 1}`,
    index: i,
  }));
}


// Vite defineConfig with PostCSS plugin array — standard Vite config pattern.
declare function defineConfig(opts: {
  css: { postcss: { plugins: unknown[] } };
  build?: { outDir: string };
}): unknown;

declare const tailwindcss: unknown;
declare const autoprefixer: unknown;

const viteConfig = defineConfig({
  css: {
    postcss: {
      plugins: [tailwindcss, autoprefixer],
    },
  },
  build: { outDir: 'dist' },
});



// FP shape: prefixed-id type string repeated across seed records in a single file (within-file-structural-repetition)
declare function prefixedId(prefix: string): string;
declare const prisma: {
  record: {
    create: (opts: { data: Record<string, unknown> }) => Promise<{ id: string }>;
  };
};

async function seedTemplates(teamId: string) {
  const template1 = await prisma.record.create({
    data: {
      id: prefixedId('envelope'),
      title: '[SEED] Template Alpha',
      teamId,
    },
  });

  const template2 = await prisma.record.create({
    data: {
      id: prefixedId('envelope'),
      title: '[SEED] Template Beta',
      teamId,
    },
  });

  return [template1, template2];
}



// Seed document ID generation - nanoid(8) uses 8 as standard short ID length
declare function nanoid(size: number): string;

export function generateSeedDocumentId(): string {
  return nanoid(8);
}

export function generateSeedFieldId(): string {
  return nanoid(8);
}
