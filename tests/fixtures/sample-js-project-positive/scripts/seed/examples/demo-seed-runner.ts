/**
 * Dev tooling: seed-database example runner.
 *
 * Lives under scripts/seed/examples/ so the file path triggers BOTH the
 * "seed-script-output" and "example-script-cli-output" suppression
 * predicates. The four console.log call sites below are intentional dev
 * tooling output, not stray production logging, and must not produce
 * console-log violations.
 */

declare const process: { env: Record<string, string | undefined> };

interface PrismaQueryEvent {
  readonly query: string;
  readonly duration: number;
}

interface PrismaClientLike {
  $on(event: 'query', handler: (e: PrismaQueryEvent) => void): void;
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
}

declare const prisma: PrismaClientLike;

// Mode 1: seed-script-output — console.log is the intended progress mechanism
// for a database seed script. The enclosing file's path ends in
// /seed/.../demo-seed-runner.ts which should suppress the violation.
export async function seedDemoData(): Promise<void> {
  await prisma.$connect();
  console.log('[seed] Demo data seeded successfully');
  await prisma.$disconnect();
}

// Mode 2: example-script-cli-output — runnable example script demonstrating
// API pagination output. File lives under /examples/ so the predicate fires.
export async function runPaginationExample(): Promise<void> {
  const documents: ReadonlyArray<{ id: string; title: string }> = [
    { id: 'doc_1', title: 'Welcome Agreement' },
    { id: 'doc_2', title: 'NDA Template' },
  ];
  for (const document of documents) {
    console.log(`Got document with id: ${document.id} and title: ${document.title}`);
  }
}

// Mode 3: prisma-query-debug-listener — console.log lives inside a
// $on('query', ...) callback. This is intentional SQL diagnostics infrastructure.
export function attachQueryLogger(): void {
  prisma.$on('query', (event) => {
    console.log(`[prisma] ${event.duration}ms`);
    console.log(`[prisma] query: ${event.query}`);
  });
}

// Mode 4: env-guarded-debug-utility — the console.log is gated by a
// process.env check, mirroring the appLog/NEXT_DEBUG debugger utility.
export function appLog(namespace: string, message: string): void {
  if (process.env['NEXT_DEBUG'] === 'true') {
    console.log(`[${namespace}] ${message}`);
  }
}
