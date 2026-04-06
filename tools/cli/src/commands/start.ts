import * as p from "@clack/prompts";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readConfig, getServerUrl, openInBrowser } from "./helpers.js";
import { getPlatform } from "./service/platform.js";
import { rotateLogs, rotateErrorLogs, getLogDir, getLogPath } from "./service/logs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getServerPath(): string {
  return path.join(__dirname, "server.mjs");
}

async function healthcheck(): Promise<boolean> {
  const url = getServerUrl();
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return true;
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function startServiceMode(openBrowser: boolean): Promise<void> {
  const platform = getPlatform();
  const serverPath = getServerPath();
  const logDir = getLogDir();
  const logPath = getLogPath();
  const url = getServerUrl();

  const { running } = await platform.status();
  if (running) {
    p.log.info(`TrueCourse is already running at ${url}`);
    return;
  }

  const installed = await platform.isInstalled();
  if (installed) {
    // Installed but stopped — start it
    rotateLogs(logDir);
    rotateErrorLogs(logDir);

    p.log.step("Starting background service...");
    await platform.start();
  } else {
    // Not installed — run install flow
    rotateLogs(logDir);
    rotateErrorLogs(logDir);

    p.log.step("Installing and starting background service...");
    await platform.install(serverPath, logPath);
  }

  const healthy = await healthcheck();
  if (healthy) {
    p.log.success(`TrueCourse is running at ${url}`);
    if (openBrowser) {
      openInBrowser(url);
    } else {
      p.log.info("Open the dashboard with: truecourse dashboard");
    }
  } else {
    p.log.warn("Service started but server hasn't responded yet.");
    p.log.info("Check logs with: truecourse service logs");
  }
}

let _serverProcess: ReturnType<typeof spawn> | null = null;

/** Get the server child process (for cleanup when started by ensureServer). */
export function getServerProcess() {
  return _serverProcess;
}

function startConsoleMode(openBrowser: boolean): void {
  const serverPath = getServerPath();
  const url = getServerUrl();

  p.log.step("Starting server (embedded PostgreSQL starts automatically)...");

  const serverProcess = _serverProcess = spawn(
    process.execPath,
    [serverPath],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    }
  );

  // Server output is piped so we can coordinate with the CLI spinner.
  // Before printing each log line, clear the spinner's current line with
  // ANSI escapes (\r = start of line, \x1b[K = clear to end of line).
  // The spinner redraws itself on its next animation tick (~80ms).
  const forwardOutput = (data: Buffer) => {
    process.stdout.write("\r\x1b[K");  // clear spinner line
    process.stderr.write(data);         // print server log
  };
  serverProcess.stdout?.on("data", forwardOutput);
  serverProcess.stderr?.on("data", forwardOutput);

  serverProcess.on("error", (error) => {
    p.log.error(`Failed to start server: ${error.message}`);
    process.exit(1);
  });

  serverProcess.on("close", (code) => {
    if (code !== null && code !== 0) {
      process.exit(code);
    }
  });

  const cleanup = () => {
    serverProcess.kill("SIGTERM");
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  healthcheck().then((healthy) => {
    if (healthy) {
      if (openBrowser) {
        openInBrowser(url);
      } else {
        p.log.info("Open the dashboard with: truecourse dashboard");
      }
    }
  });
}

export async function runStart({ openBrowser = false } = {}): Promise<void> {
  p.intro("Starting TrueCourse");

  const config = readConfig();

  if (config.runMode === "service") {
    try {
      await startServiceMode(openBrowser);
    } catch (error: any) {
      p.log.error(`Service mode failed: ${error.message}`);
      p.log.info("Falling back to console mode. Reconfigure with: truecourse setup");
      startConsoleMode(openBrowser);
    }
  } else {
    startConsoleMode(openBrowser);
  }
}
