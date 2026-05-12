/**
 * Standalone runnable example scripts.
 *
 * These files live under an `examples/` directory and are not part of the
 * shared library surface. Each file is a self-contained CLI entry point
 * that defines its own `main()` and invokes it at the top level, with
 * `process.exit(1)` in the failure handler. The rule should not fire on
 * paths under `examples/` (entry-point scripts), even though the file is
 * not named index/main/cli/server/app/worker.
 */

// ── Mode: example-entry-point-scripts ─────────────────────────────────────
// Mirrors packages/api/v1/examples/01-create-and-send-document.ts in
// documenso. A top-level `main().catch((error) => { process.exit(1); })`
// invocation in a file under `examples/` is an entry-point script pattern,
// not library code.

declare const documensoClient: {
  createDocument: (input: { readonly title: string; readonly recipients: readonly string[] }) => Promise<{ readonly id: string }>;
  sendDocument: (id: string) => Promise<void>;
};

async function main(): Promise<void> {
  const document = await documensoClient.createDocument({
    title: 'Example Agreement',
    recipients: ['signer@example.com'],
  });

  await documensoClient.sendDocument(document.id);
  console.log(`Created and sent document ${document.id}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

// ── Mode: seed-and-data-scripts ───────────────────────────────────────────
// Mirrors packages/prisma/seed-database.ts in documenso. A standalone
// data-setup script that invokes its top-level function and uses
// `.then(() => process.exit(0))` / `.catch(() => process.exit(1))` as the
// CLI exit-code convention. Not a shared library module.

declare const prisma: {
  user: { create: (args: { readonly data: { readonly email: string } }) => Promise<{ readonly id: string }> };
  $disconnect: () => Promise<void>;
};

async function seedDatabase(): Promise<void> {
  await prisma.user.create({ data: { email: 'seed@example.com' } });
  await prisma.$disconnect();
}

seedDatabase()
  .then(() => {
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
