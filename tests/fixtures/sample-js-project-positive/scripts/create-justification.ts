
// safe-value-pass-no-property-access: catch(err) only console.error(err) and sets process.exitCode; no property access
declare function runDatabaseSeed(batchSize: number): Promise<void>;

async function seedLargeDataset(batchSize: number): Promise<void> {
  try {
    await runDatabaseSeed(batchSize);
    console.log('Seed completed successfully');
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  }
}



// safe-value-pass-no-property-access: catch(error) only console.error('label:', error) passing as value; no property access
declare function readStdinLines(): Promise<string[]>;

async function processStdinInput(): Promise<string[] | null> {
  try {
    return await readStdinLines();
  } catch (error) {
    console.error('Error reading from stdin:', error);
    return null;
  }
}
