

declare function mkdirSync(path: string, opts: { recursive: boolean }): void;
declare function writeFileSync(path: string, data: string, encoding: string): void;
declare function readFileSync(fd: number, encoding: string): string;
declare const process: { argv: string[]; cwd(): string; exit(code: number): never };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };
declare function joinPath(...parts: string[]): string;
declare function generateMarkerId(): string;

const MARKERS_DIR = joinPath(process.cwd(), '.agents', 'markers');

const createMarker = () => {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: npx tsx scripts/create-marker.ts "marker-slug" [content]');
    console.error('  or:   npx tsx scripts/create-marker.ts "marker-slug" << HEREDOC');
    process.exit(1);
  }

  const slug = args[0];
  let body = '';

  // Check if body is provided as second argument
  if (args.length > 1) {
    body = args.slice(1).join(' ');
  } else {
    // Read from stdin (heredoc)
    try {
      const stdin = readFileSync(0, 'utf-8');
      body = stdin.trim();
    } catch (err) {
      console.error('Error reading from stdin:', err);
      process.exit(1);
    }
  }

  if (!body) {
    console.error('Error: No body provided');
    process.exit(1);
  }

  // Generate unique ID
  const id = generateMarkerId();
  const filename = `${id}-${slug}.md`;
  const filepath = joinPath(MARKERS_DIR, filename);

  // Format heading from slug (kebab-case to Title Case)
  const heading = slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  // Get current date in ISO format
  const date = new Date().toISOString().split('T')[0];

  // Build frontmatter
  const frontmatter = `---\ndate: ${date}\ntitle: ${heading}\n---\n\n`;

  // Ensure directory exists
  mkdirSync(MARKERS_DIR, { recursive: true });

  // Write file with frontmatter
  writeFileSync(filepath, frontmatter + body, 'utf-8');

  console.log(`Created marker: ${filepath}`);
  console.log(`ID: ${id}`);
  console.log(`Filename: ${filename}`);
};

createMarker();
