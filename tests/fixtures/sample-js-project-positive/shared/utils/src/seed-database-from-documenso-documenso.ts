/**
 * Paraphrased FP from documenso/documenso for
 * reliability/deterministic/process-exit-in-library.
 *
 * Seed scripts and runnable example scripts are CLI entrypoints — they're
 * invoked by `prisma db seed`, by direct `node` invocation, or by README
 * snippets. `process.exit` is the conventional way they signal success or
 * failure to the parent shell. They are NOT library code.
 */

declare const console: { error(msg: string, err?: unknown): void };
declare const process: { exit(code?: number): never };

export const runSeed = async (): Promise<void> => {
  await Promise.resolve();
};

runSeed()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
