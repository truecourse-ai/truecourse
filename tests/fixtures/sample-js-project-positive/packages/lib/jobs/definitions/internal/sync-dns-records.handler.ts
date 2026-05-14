
declare const io: { logger: { info: (msg: string) => void; error: (msg: string) => void } };

async function processDnsRecordResults(
  results: Array<{ status: 'fulfilled' | 'rejected'; value?: string; reason?: any }>,
) {
  let errorCount = 0;
  let verifiedCount = 0;
  let skippedCount = 0;

  for (const result of results) {
    if (result.status === 'rejected') {
      errorCount++;
      io.logger.error(`Failed to process DNS record: ${String(result.reason)}`);
    } else if (result.value === 'verified') {
      verifiedCount++;
    } else if (result.value === 'skipped') {
      skippedCount++;
    }
  }

  io.logger.info(
    `Sync complete: ${verifiedCount} verified, ${skippedCount} skipped, ${errorCount} errors`,
  );
}
