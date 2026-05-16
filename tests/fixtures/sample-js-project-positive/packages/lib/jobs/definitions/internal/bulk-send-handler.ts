
// FP: results.errors as string[] — the errors array is built by pushing strings only.
// The assertion is structurally guaranteed by the preceding code.
declare const prisma: { user: { findFirstOrThrow: (q: unknown) => Promise<{ email: string; name: string }> } };

async function processBulkJob(userId: number, rows: Record<string, string>[]) {
  const user = await prisma.user.findFirstOrThrow({ where: { id: userId }, select: { email: true, name: true } });

  const results = {
    success: 0,
    failed: 0,
    errors: [] as string[],
  };

  for (const row of rows) {
    try {
      if (!row['email']) throw new Error('Missing email');
      results.success++;
    } catch (err) {
      results.failed++;
      results.errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return results;
}
