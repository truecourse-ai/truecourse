import * as p from "@clack/prompts";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRepoDir } from "@truecourse/core/config/paths";
import { getProjectByPath, registerProject } from "@truecourse/core/config/registry";
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

/**
 * The running dashboard, probed from reality rather than from `config.runMode`.
 *
 * `config.runMode` records the user's *preference* at setup time. It can drift
 * from reality if, for example, the user reconfigures to "console" while a
 * service is still active on the port. `status`/`stop`/`logs` must derive
 * actual state from the platform service and the health endpoint, not from
 * the config file alone.
 */
type RunningState =
  | { mode: "service"; pid?: number; healthy: boolean }
  | { mode: "console"; healthy: true }
  | { mode: "none" };

async function probeHealth(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}

async function detectRunningState(): Promise<RunningState> {
  const platform = getPlatform();
  const url = getServerUrl();
  const healthy = await probeHealth(url);

  if (await platform.isInstalled()) {
    const { running, pid } = await platform.status();
    if (running) return { mode: "service", pid, healthy };
    // Service installed but not running: if something else is answering on
    // the port, treat that as a console-mode process (e.g. `pnpm dev`).
    if (healthy) return { mode: "console", healthy: true };
    return { mode: "none" };
  }

  if (healthy) return { mode: "console", healthy: true };
  return { mode: "none" };
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
  // Persist only after the mode actually starts below — see the block after
  // runServiceMode / runConsoleMode. Writing upfront caused the bug where a
  // failed console attempt left config in a stale state (PR #55 context).
  const shouldPersist = needsDecision || options.mode !== undefined;

  // If the user is switching away from service mode but the service is still
  // installed and/or running, starting a new process on the same port will
  // silently fail or collide. Refuse and point at the right command rather
  // than writing a stale `runMode` that status/stop then disagree with.
  if (runMode !== "service") {
    const platform = getPlatform();
    if (await platform.isInstalled()) {
      const { running } = await platform.status();
      if (running) {
        p.log.error(
          "A dashboard service is already installed and running. Stop and remove it " +
            "first: `truecourse dashboard uninstall`, then rerun `truecourse dashboard`.",
        );
        process.exit(1);
      }
    }
  }

  // Only persist the chosen mode AFTER we've validated it can actually run.
  // If the mode-starting function (runServiceMode / runConsoleMode) fails or
  // exits, the old config stays on disk — status/stop won't be misled.
  if (runMode === "service") {
    try {
      await runServiceMode(serverEntry);
    } catch (err) {
      p.log.error(`Service mode failed: ${(err as Error).message}`);
      p.log.info("Falling back to console mode.");
      await runConsoleMode(serverEntry);
      if (shouldPersist) writeConfig({ runMode: "console" });
      return;
    }
    if (shouldPersist) writeConfig({ runMode: "service" });
  } else {
    await runConsoleMode(serverEntry);
    if (shouldPersist) writeConfig({ runMode: "console" });
  }
}

export async function runDashboardStop(): Promise<void> {
  const state = await detectRunningState();

  switch (state.mode) {
    case "service": {
      p.log.step("Stopping dashboard service...");
      await getPlatform().stop();
      p.log.success("Dashboard service stopped.");
      return;
    }
    case "console": {
      p.log.info(
        "A dashboard is running in console mode (not managed by the service). " +
          "Press Ctrl+C in its terminal to stop it.",
      );
      return;
    }
    case "none": {
      p.log.info("Dashboard is not running.");
      return;
    }
  }
}

export async function runDashboardStatus(): Promise<void> {
  const state = await detectRunningState();
  const url = getServerUrl();

  switch (state.mode) {
    case "service": {
      const pidInfo = state.pid ? ` (PID: ${state.pid})` : "";
      p.log.success(`Dashboard service is running${pidInfo}`);
      if (state.healthy) {
        p.log.info(`Server is healthy at ${url}`);
      } else {
        p.log.warn(`Service process is running but server is not responding at ${url}.`);
      }
      return;
    }
    case "console": {
      p.log.success(`Dashboard is running in console mode at ${url}`);
      return;
    }
    case "none": {
      const platform = getPlatform();
      if (await platform.isInstalled()) {
        p.log.info("Dashboard service is installed but not running.");
      } else {
        p.log.info("Dashboard is not running.");
      }
      return;
    }
  }
}

export async function runDashboardLogs(): Promise<void> {
  const state = await detectRunningState();
  if (state.mode === "console") {
    p.log.info("Dashboard is running in console mode — logs print to its terminal.");
    return;
  }
  // Service mode or not-running: either way the service's log file is the
  // right place. tailLogs() handles the missing-log case.
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
