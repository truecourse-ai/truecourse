import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_LOG_FILES = 5;
const POLL_INTERVAL_MS = 500;

// All service supervisors and the dashboard server itself land their logs in
// this dir. Filenames follow a single contract every platform installer
// translates into its native format:
//
//   dashboard.log         — server's structured log (always present once boot
//                           reaches the logger configure step)
//   dashboard.out.log     — supervisor-captured stdout (launchd / systemd /
//                           node-windows)
//   dashboard.err.log     — supervisor-captured stderr
//   dashboard.wrapper.log — node-windows supervisor's own events (Windows
//                           only; child started/exited/restart counters)
//
// Plus legacy names from older installs we still surface so users on stale
// service registrations see their logs without reinstalling.
const KNOWN_LOG_FILENAMES = [
  "dashboard.log",
  "dashboard.out.log",
  "dashboard.err.log",
  "dashboard.wrapper.log",
  // Legacy (pre-unified-layout) — kept for backward compatibility with
  // existing macOS/Linux service registrations.
  "truecourse.log",
  "truecourse.error.log",
];

export function getLogDir(): string {
  return path.join(os.homedir(), ".truecourse", "logs");
}

/**
 * Path of the structured app log. Kept for backward compatibility with
 * callers that pass a single representative log path (e.g. service
 * installers that take `logPath` as a stand-in for "the log dir").
 */
export function getLogPath(): string {
  return path.join(getLogDir(), "dashboard.log");
}

function existingLogFiles(logDir: string): string[] {
  return KNOWN_LOG_FILENAMES
    .map((name) => path.join(logDir, name))
    .filter((p) => fs.existsSync(p));
}

/**
 * Generic size-based rotation: file → file.1 → file.2 → … → file.MAX.
 * Skips files below MAX_LOG_SIZE.
 */
function rotateOne(logFile: string): void {
  if (!fs.existsSync(logFile)) return;
  if (fs.statSync(logFile).size < MAX_LOG_SIZE) return;

  for (let i = MAX_LOG_FILES; i >= 1; i--) {
    const older = `${logFile}.${i}`;
    if (i === MAX_LOG_FILES) {
      if (fs.existsSync(older)) fs.unlinkSync(older);
    } else {
      const newer = `${logFile}.${i + 1}`;
      if (fs.existsSync(older)) fs.renameSync(older, newer);
    }
  }
  fs.renameSync(logFile, `${logFile}.1`);
}

/**
 * Rotate every known log file in the dir if oversized. Called by `dashboard`
 * before (re)starting the service so the supervisor opens fresh files.
 */
export function rotateLogs(logDir: string): void {
  for (const name of KNOWN_LOG_FILENAMES) {
    rotateOne(path.join(logDir, name));
  }
}

function readLastLines(filePath: string, maxLines: number): string {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  // Drop trailing empty line that comes from a final \n.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.slice(-maxLines).join("\n");
}

/**
 * Print the last N lines of every known log file in `logDir`. Used both by
 * the boot-failure path (so the user sees the actual error inline instead of
 * a generic "check logs" hint) and as the "show me what we have so far"
 * preamble of the live `tailLogs` follow.
 *
 * Returns true if at least one log file was found.
 */
export function dumpLogTails(logDir: string, linesPerFile = 50): boolean {
  const files = existingLogFiles(logDir);
  if (files.length === 0) return false;

  for (const file of files) {
    const tail = readLastLines(file, linesPerFile);
    process.stdout.write(`\n----- ${path.basename(file)} (last ${linesPerFile} lines) -----\n`);
    process.stdout.write(tail);
    if (!tail.endsWith("\n")) process.stdout.write("\n");
  }
  return true;
}

/**
 * Print the tail of every known log file, then follow all of them for new
 * content. Cross-platform: uses fs.watchFile polling so the same code path
 * works on Windows (no `tail -f` binary) and POSIX.
 */
export function tailLogs(): void {
  const logDir = getLogDir();
  const files = existingLogFiles(logDir);
  if (files.length === 0) {
    console.log("No log files found. Is the service running?");
    console.log(`Expected under: ${logDir}`);
    return;
  }

  // Initial tail dump.
  dumpLogTails(logDir);

  // Track current size of each file; when it grows, print the delta with a
  // [filename] tag so interleaved output stays readable.
  const sizes = new Map<string, number>();
  for (const file of files) sizes.set(file, fs.statSync(file).size);

  const watch = (file: string) => {
    fs.watchFile(file, { interval: POLL_INTERVAL_MS }, () => {
      try {
        const newSize = fs.statSync(file).size;
        const lastSize = sizes.get(file) ?? 0;
        if (newSize > lastSize) {
          const fd = fs.openSync(file, "r");
          const buf = Buffer.alloc(newSize - lastSize);
          fs.readSync(fd, buf, 0, buf.length, lastSize);
          fs.closeSync(fd);
          const tag = `[${path.basename(file)}] `;
          const text = buf.toString("utf-8");
          // Tag each non-empty line so the source is unambiguous.
          const tagged = text
            .split("\n")
            .map((line, i, arr) => (i === arr.length - 1 && line === "" ? "" : tag + line))
            .join("\n");
          process.stdout.write(tagged);
          sizes.set(file, newSize);
        } else if (newSize < lastSize) {
          // Truncated/rotated — reset our cursor.
          sizes.set(file, newSize);
        }
      } catch {
        // File may have been rotated away mid-poll; ignore.
      }
    });
  };

  for (const file of files) watch(file);

  const cleanup = () => {
    for (const file of files) fs.unwatchFile(file);
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}
