
// --- FP shape: CommonJS require() with path.join result ---
declare const path: { join(...segments: string[]): string };
declare function require(id: string): unknown;
declare const __dirname: string;
declare const seedFiles: string[];

for (const file of seedFiles) {
  require(path.join(__dirname, './seeds', file));
}



// --- FP shape: seed runner executing seed files sequentially (later seeds depend on earlier) ---
declare function runSeedFile(filename: string): Promise<void>;
declare const seedSequence: string[];

async function runAllSeeds(): Promise<void> {
  for (const seedFile of seedSequence) {
    await runSeedFile(seedFile);
  }
}
