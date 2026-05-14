
// Seed script: paired console.error calls — first with context string, second with error object
async function seedLargeDataSet(): Promise<void> {
  try {
    await insertBulkRecords();
    console.log('[SEEDING]: Large dataset seeded successfully.');
  } catch (err) {
    console.error('[SEEDING]: Failed to seed large dataset.');
    console.error(err);
    process.exit(1);
  }
}

declare function insertBulkRecords(): Promise<void>;
