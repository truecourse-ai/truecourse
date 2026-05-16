
// argument-type-mismatch FP: fs.readFileSync().toString('base64') chained call
declare const fs: { readFileSync: (path: string) => { toString: (encoding: string) => string } };

function readFileAsBase64(filePath: string): string {
  return fs.readFileSync(filePath).toString('base64');
}

export { readFileAsBase64 };



// argument-type-mismatch FP: process.exit with numeric exit code
declare const process: { exit: (code: number) => never; env: Record<string, string | undefined> };

function requireEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

export { requireEnvVar };



declare function seedLargeTeam(teamId: string, memberCount: number): Promise<void>;

async function runTeamSeed(teamId: string, memberCount: number): Promise<void> {
  try {
    await seedLargeTeam(teamId, memberCount);
  } catch (err) {
    console.error('Failed to seed team members');
    console.error(err);
  }
}



declare function readStdin(): Promise<string>;

async function processStdinInput(): Promise<void> {
  try {
    const input = await readStdin();
    console.log('Read input:', input.length, 'bytes');
  } catch (error) {
    console.error('Error reading from stdin:', error);
    process.exit(1);
  }
}
