import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_LOG_FILES = 5;

export function getLogDir(): string {
  return path.join(os.homedir(), ".truecourse", "logs");
}

export function getLogPath(): string {
  return path.join(getLogDir(), "truecourse.log");
}

/**
 * Rotate logs if the current log file exceeds MAX_LOG_SIZE.
 * Shifts .1 → .2 → ... → .5, then renames current to .1.
 */
export function rotateLogs(logDir: string): void {
  const logFile = path.join(logDir, "truecourse.log");

  if (!fs.existsSync(logFile)) return;

  const stats = fs.statSync(logFile);
  if (stats.size < MAX_LOG_SIZE) return;

  // Shift existing rotated files
  for (let i = MAX_LOG_FILES; i >= 1; i--) {
    const older = path.join(logDir, `truecourse.log.${i}`);
    if (i === MAX_LOG_FILES) {
      // Delete the oldest
      if (fs.existsSync(older)) fs.unlinkSync(older);
    } else {
      const newer = path.join(logDir, `truecourse.log.${i + 1}`);
      if (fs.existsSync(older)) fs.renameSync(older, newer);
    }
  }

  // Rename current to .1
  fs.renameSync(logFile, path.join(logDir, "truecourse.log.1"));
}

/**
 * Also rotate error logs with same strategy.
 */
export function rotateErrorLogs(logDir: string): void {
  const logFile = path.join(logDir, "truecourse.error.log");

  if (!fs.existsSync(logFile)) return;

  const stats = fs.statSync(logFile);
  if (stats.size < MAX_LOG_SIZE) return;

  for (let i = MAX_LOG_FILES; i >= 1; i--) {
    const older = path.join(logDir, `truecourse.error.log.${i}`);
    if (i === MAX_LOG_FILES) {
      if (fs.existsSync(older)) fs.unlinkSync(older);
    } else {
      const newer = path.join(logDir, `truecourse.error.log.${i + 1}`);
      if (fs.existsSync(older)) fs.renameSync(older, newer);
    }
  }

  fs.renameSync(logFile, path.join(logDir, "truecourse.error.log.1"));
}

/**
 * Tail the log file, following new content.
 */
export function tailLogs(): void {
  const logFile = getLogPath();

  if (!fs.existsSync(logFile)) {
    console.log("No log file found. Is the service running?");
    console.log(`Expected at: ${logFile}`);
    return;
  }

  if (process.platform === "win32") {
    // On Windows, read and watch
    const content = fs.readFileSync(logFile, "utf-8");
    const lines = content.split("\n");
    // Print last 50 lines
    const tail = lines.slice(-50);
    for (const line of tail) {
      process.stdout.write(line + "\n");
    }

    // Watch for changes
    let lastSize = fs.statSync(logFile).size;
    fs.watchFile(logFile, { interval: 500 }, () => {
      const newSize = fs.statSync(logFile).size;
      if (newSize > lastSize) {
        const fd = fs.openSync(logFile, "r");
        const buf = Buffer.alloc(newSize - lastSize);
        fs.readSync(fd, buf, 0, buf.length, lastSize);
        fs.closeSync(fd);
        process.stdout.write(buf.toString("utf-8"));
        lastSize = newSize;
      }
    });
  } else {
    // macOS/Linux: use tail -f
    const tail = spawn("tail", ["-f", "-n", "50", logFile], {
      stdio: "inherit",
    });

    const cleanup = () => {
      tail.kill("SIGTERM");
    };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    tail.on("close", () => {
      process.exit(0);
    });
  }
}
