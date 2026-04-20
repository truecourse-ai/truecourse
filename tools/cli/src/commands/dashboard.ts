import * as p from "@clack/prompts";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRepoDir } from "@truecourse/server/config/paths";
import { getProjectByPath, registerProject } from "@truecourse/server/config/registry";
import {
  exitMissingNonInteractiveFlag,
  getConfigPath,
  getServerUrl,
  isInteractive,
  openInBrowser,
  readConfig,
  writeConfig,
  type TrueCourseConfig,
} from "./helpers.js";
import { getPlatform } from "./service/platform.js";
import { rotateLogs, rotateErrorLogs, getLogDir, getLogPath, tailLogs } from "./service/logs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveServerEntry(): string | null {
  const candidates = [
    // Packaged CLI: dist/cli.mjs next to dist/server.mjs
    path.join(__dirname, "server.mjs"),
    // Source build output: tools/cli/dist → ../../../../dist/server.mjs
    path.resolve(__dirname, "..", "..", "..", "..", "dist", "server.mjs"),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

async function waitForHealth(url: string, timeoutMs = 30_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return true;
    } catch {
      // keep polling
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function targetUrlFor(baseUrl: string): string {
  const repoDir = resolveRepoDir(process.cwd());
  if (!repoDir) return baseUrl;
  const entry = getProjectByPath(repoDir) ?? registerProject(repoDir);
  return `${baseUrl}/repos/${entry.slug}`;
}

async function promptRunMode(): Promise<TrueCourseConfig["runMode"]> {
  const choice = await p.select<TrueCourseConfig["runMode"]>({
    message: "How would you like to run the dashboard?",
    options: [
      { value: "service", label: "Background service (Recommended)", hint: "runs even after you close the terminal" },
      { value: "console", label: "Console", hint: "keep this terminal open" },
    ],
  });
  if (p.isCancel(choice)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }
  return choice;
}

async function runConsoleMode(serverEntry: string): Promise<void> {
  const url = getServerUrl();

  p.log.step("Starting dashboard server...");
  const serverProcess = spawn(process.execPath, [serverEntry], {
    stdio: "inherit",
    env: { ...process.env },
  });

  const forward = (signal: NodeJS.Signals) => {
    if (!serverProcess.killed) serverProcess.kill(signal);
  };
  process.on("SIGINT", () => forward("SIGINT"));
  process.on("SIGTERM", () => forward("SIGTERM"));

  serverProcess.on("error", (err) => {
    p.log.error(`Failed to start server: ${err.message}`);
    process.exit(1);
  });

  serverProcess.on("close", (code) => {
    process.exit(code ?? 0);
  });

  const healthy = await waitForHealth(url);
  if (!healthy) {
    p.log.error("Server did not become healthy in time.");
    forward("SIGTERM");
    process.exit(1);
  }

  const target = targetUrlFor(url);
  openInBrowser(target);
  p.log.success(`Dashboard open at ${target}`);
  p.log.info("Press Ctrl+C to stop the server.");
}

async function runServiceMode(serverEntry: string): Promise<void> {
  const platform = getPlatform();
  const logDir = getLogDir();
  const logPath = getLogPath();
  const url = getServerUrl();

  rotateLogs(logDir);
  rotateErrorLogs(logDir);

  const installed = await platform.isInstalled();
  if (!installed) {
    p.log.step("Installing background service...");
    await platform.install(serverEntry, logPath);
  } else {
    const { running } = await platform.status();
    if (!running) {
      p.log.step("Starting background service...");
      await platform.start();
    }
  }

  const healthy = await waitForHealth(url);
  if (!healthy) {
    p.log.warn("Service started but server hasn't responded yet.");
    p.log.info("Check logs with: truecourse dashboard logs");
    process.exit(1);
  }

  const target = targetUrlFor(url);
  openInBrowser(target);
  p.log.success(`Dashboard open at ${target}`);
  p.log.info("Stop the dashboard with: truecourse dashboard stop");
}

export interface DashboardOptions {
  /** Force reconfigure (prompts for mode even if already configured). */
  reconfigure?: boolean;
  /**
   * Pre-select the run mode without prompting. Mutually exclusive with
   * each other; either is mutually exclusive with prompting. Required
   * when running non-interactively and the mode isn't already configured.
   */
  mode?: TrueCourseConfig["runMode"];
}

export async function runDashboard(options: DashboardOptions = {}): Promise<void> {
  p.intro("Opening TrueCourse dashboard");

  const serverEntry = resolveServerEntry();
  if (!serverEntry) {
    p.log.error(
      "Packaged server entry not found. If you're developing, run the dashboard with `pnpm dev`.",
    );
    process.exit(1);
  }

  const configured = fs.existsSync(getConfigPath());
  const needsDecision = !configured || options.reconfigure;

  let runMode: TrueCourseConfig["runMode"];
  if (options.mode) {
    runMode = options.mode;
  } else if (needsDecision) {
    if (!isInteractive()) {
      exitMissingNonInteractiveFlag(
        "Dashboard run mode is not configured.",
        "Pass --service for the background service or --console to run in this terminal.",
      );
    }
    runMode = await promptRunMode();
  } else {
    runMode = readConfig().runMode;
  }
  const shouldPersist = needsDecision || options.mode !== undefined;
  if (shouldPersist) writeConfig({ runMode });

  if (runMode === "service") {
    try {
      await runServiceMode(serverEntry);
    } catch (err) {
      p.log.error(`Service mode failed: ${(err as Error).message}`);
      p.log.info("Falling back to console mode.");
      await runConsoleMode(serverEntry);
    }
  } else {
    await runConsoleMode(serverEntry);
  }
}

export async function runDashboardStop(): Promise<void> {
  const config = readConfig();
  if (config.runMode !== "service") {
    p.log.info("Dashboard is running in console mode. Press Ctrl+C in its terminal to stop.");
    return;
  }

  const platform = getPlatform();
  const { running } = await platform.status();
  if (!running) {
    p.log.info("Dashboard is not running.");
    return;
  }

  p.log.step("Stopping dashboard...");
  await platform.stop();
  p.log.success("Dashboard stopped.");
}

export async function runDashboardStatus(): Promise<void> {
  const config = readConfig();
  const url = getServerUrl();

  if (config.runMode !== "service") {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) {
        p.log.success(`Dashboard is running in console mode at ${url}`);
      } else {
        p.log.info("Dashboard is not running.");
      }
    } catch {
      p.log.info("Dashboard is not running.");
    }
    return;
  }

  const platform = getPlatform();
  const installed = await platform.isInstalled();
  if (!installed) {
    p.log.info("Dashboard service is not installed. Run `truecourse dashboard` to set it up.");
    return;
  }

  const { running, pid } = await platform.status();
  if (!running) {
    p.log.info("Dashboard service is installed but not running.");
    return;
  }

  const pidInfo = pid ? ` (PID: ${pid})` : "";
  p.log.success(`Dashboard service is running${pidInfo}`);
  try {
    const res = await fetch(`${url}/api/health`);
    if (res.ok) {
      p.log.info(`Server is healthy at ${url}`);
    } else {
      p.log.warn(`Server returned status ${res.status}`);
    }
  } catch {
    p.log.warn("Service process is running but server is not responding.");
  }
}

export function runDashboardLogs(): void {
  const config = readConfig();
  if (config.runMode !== "service") {
    p.log.info("Dashboard is running in console mode — logs print to its terminal.");
    return;
  }
  tailLogs();
}

export async function runDashboardUninstall(): Promise<void> {
  const config = readConfig();
  if (config.runMode !== "service") {
    p.log.info("Dashboard isn't installed as a service — nothing to uninstall.");
    return;
  }

  const platform = getPlatform();
  const installed = await platform.isInstalled();
  if (!installed) {
    p.log.info("Dashboard service is not installed.");
    writeConfig({ runMode: "console" });
    return;
  }

  p.log.step("Removing background service...");
  await platform.uninstall();
  writeConfig({ runMode: "console" });
  p.log.success("Service removed. Dashboard will run in console mode next time.");
}
