
// D15: async map in database seed — no type mismatch
declare const prisma: {
  field: {
    create(args: { data: { id: string; type: string; pageNumber: number; positionX: number; positionY: number } }): Promise<{ id: string }>;
  };
};

interface FieldTemplate {
  type: string;
  pageNumber: number;
  positionX: number;
  positionY: number;
}

const SEED_FIELDS: FieldTemplate[] = [
  { type: 'SIGNATURE', pageNumber: 1, positionX: 100, positionY: 200 },
  { type: 'DATE', pageNumber: 1, positionX: 300, positionY: 200 },
  { type: 'TEXT', pageNumber: 2, positionX: 50, positionY: 100 },
];

export async function seedDocumentFields(documentId: string): Promise<void> {
  await Promise.all(
    SEED_FIELDS.map(async (field) => {
      await prisma.field.create({
        data: {
          id: `${documentId}-${field.type}`,
          type: field.type,
          pageNumber: field.pageNumber,
          positionX: field.positionX,
          positionY: field.positionY,
        },
      });
    })
  );
}



// G35: Buffer.toString with encoding string — correct; no type mismatch
declare const fs: { readFileSync: (path: string) => Buffer };
declare const path: { join: (...parts: string[]) => string };
declare const __dirname: string;

function loadFileAsBase64(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, relativePath)).toString('base64');
}

const samplePdfBase64 = loadFileAsBase64('assets/sample.pdf');



// G38: Promise.all with async ORM map — standard pattern; no type mismatch
declare const db: {
  field: { create: (opts: { data: { formId: string; label: string; order: number } }) => Promise<{ id: string }> };
};
declare const SEED_FIELDS: Array<{ label: string; order: number }>;
declare const formId: string;

async function seedFormFields(): Promise<Array<{ id: string }>> {
  return Promise.all(
    SEED_FIELDS.map(async (field) =>
      db.field.create({
        data: { formId, label: field.label, order: field.order },
      }),
    ),
  );
}



// H18: Node.js file read — standard fs usage, no type mismatch
declare const fs: { readFileSync(path: string, encoding: string): string };
declare const path: { join(...parts: string[]): string };
declare const __dirname: string;

function loadSeedData(filename: string): Record<string, unknown>[] {
  const filePath = path.join(__dirname, 'data', filename);
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as Record<string, unknown>[];
}

const userSeedData = loadSeedData('users.json');
const roleSeedData = loadSeedData('roles.json');



// Wave-M29: fs.readFileSync(...).toString('base64') — Node.js file read with encoding, no type mismatch
declare const fs: { readFileSync: (path: string) => { toString: (encoding: string) => string } };
declare const path: { join: (...parts: string[]) => string };
declare const __dirname: string;

const pdfBase64 = fs.readFileSync(path.join(__dirname, '../assets/sample.pdf')).toString('base64');
const fontBase64 = fs.readFileSync(path.join(__dirname, '../assets/font.ttf')).toString('base64');



// Shape: Promise.all() with array of same-type async calls, destructured results
declare function provisionAccount(opts?: { role?: string }): Promise<{ id: string; email: string }>;

async function seedTestAccounts() {
  const [
    adminAccount,
    memberAccount1,
    memberAccount2,
    guestAccount,
  ] = await Promise.all([
    provisionAccount({ role: 'admin' }),
    provisionAccount(),
    provisionAccount(),
    provisionAccount({ role: 'guest' }),
  ]);

  return { adminAccount, memberAccount1, memberAccount2, guestAccount };
}



// Shape: fs.statSync(path.join(...)) — path.join returns string, statSync accepts string
declare const fs: { statSync(path: string): { isFile(): boolean }; readdirSync(path: string): string[] };
declare const path: { join(...parts: string[]): string };
declare const __dirname: string;

function loadSeedFiles(seedDir: string): string[] {
  const files = fs.readdirSync(path.join(__dirname, seedDir));
  return files.filter((file) => {
    const stat = fs.statSync(path.join(__dirname, seedDir, file));
    return stat.isFile();
  });
}



// Shape 63d36323f134: process.argv.slice(2) — standard Node.js argv parsing.
const cliArgs: string[] = process.argv.slice(2);
const targetEnv: string = cliArgs[0] ?? 'development';
const dryRun: boolean = cliArgs.includes('--dry-run');

console.log(`Running seed for env=${targetEnv} dryRun=${dryRun}`);



// FF38 — Promise.all with multiple seed function calls; no type mismatch
declare function seedWorkspace(input: { name: string; plan: string }): Promise<{ id: string }>;
declare function seedUser(input: { email: string; workspaceId: string }): Promise<{ id: string }>;

async function seedDatabase() {
  const [workspace1, workspace2] = await Promise.all([
    seedWorkspace({ name: 'Acme Corp', plan: 'pro' }),
    seedWorkspace({ name: 'Beta Inc', plan: 'starter' }),
  ]);

  await Promise.all([
    seedUser({ email: 'admin@acme.com', workspaceId: workspace1.id }),
    seedUser({ email: 'admin@beta.com', workspaceId: workspace2.id }),
  ]);
}



// cf7f727f452c: fs.readdirSync(path.join(...)) — string path from path.join
declare const fs: { readdirSync(path: string): string[] };
declare const path: { join(...parts: string[]): string };
declare const __dirname: string;

function listSeedFiles(): string[] {
  return fs.readdirSync(path.join(__dirname, './fixtures'));
}



// --- no-void shape: module-level-or-non-react-async-init (void main() at top level) ---
async function seedDatabase(): Promise<void> {
  console.log('Seeding database...');
}

void seedDatabase();
