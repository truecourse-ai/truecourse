// FP shape: Array.from({length}).fill(null).map(() => crypto.randomBytes().toString()) — no type mismatch
declare const crypto: { randomBytes: (size: number) => { toString: (encoding: string) => string } };

function generateBackupCodes(count: number = 10): string[] {
  return Array.from({ length: count })
    .fill(null)
    .map(() => crypto.randomBytes(5).toString('hex'));
}



// E34: path.join(process.cwd(), ...) — Node.js path joining; no type mismatch.
declare const join2: (...paths: string[]) => string;
declare const process2: { cwd(): string };

const REPORTS_DIR = join2(process2.cwd(), '.agent-data', 'reports');
const CACHE_DIR = join2(process2.cwd(), '.cache', 'generated');



// E46: string .split('-').map() kebab-to-title-case — standard string transformation; no type mismatch.
declare const categorySlug: string;

const categoryTitle = categorySlug
  .split('-')
  .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
  .join(' ');
