import * as p from "@clack/prompts";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readConfig, getServerUrl } from "./helpers.js";
import { getPlatform } from "./service/platform.js";
import { rotateLogs, rotateErrorLogs, getLogDir, getLogPath } from "./service/logs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getServerPath(): string {
  return path.join(__dirname, "server.mjs");
}

async function healthcheck(): Promise<boolean> {
  const url = getServerUrl();
  for (let i = 0; i < 30; i++) {
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

async function startServiceMode(): Promise<void> {
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
  } else {
    p.log.warn("Service started but server hasn't responded yet.");
    p.log.info("Check logs with: truecourse service logs");
  }
}

function startConsoleMode(): void {
  const serverPath = getServerPath();

  p.log.step("Starting server (embedded PostgreSQL starts automatically)...");

  const serverProcess = spawn(
    process.execPath,
    [serverPath],
    {
      stdio: "inherit",
      env: { ...process.env },
    }
  );

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
}

export async function runStart(): Promise<void> {
  p.intro("Starting TrueCourse");

  const config = readConfig();

  if (config.runMode === "service") {
    try {
      await startServiceMode();
    } catch (error: any) {
      p.log.error(`Service mode failed: ${error.message}`);
      p.log.info("Falling back to console mode. Reconfigure with: truecourse setup");
      startConsoleMode();
    }
  } else {
    startConsoleMode();
  }
}
