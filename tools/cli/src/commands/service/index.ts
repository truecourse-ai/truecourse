import * as p from "@clack/prompts";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import { getPlatform } from "./platform.js";
import { rotateLogs, rotateErrorLogs, getLogDir, getLogPath, tailLogs } from "./logs.js";
import { readConfig, writeConfig, getServerUrl } from "../helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getServerPath(): string {
  // In packaged mode, server.mjs is at dist/server.mjs (two levels up from service/)
  return path.join(__dirname, "..", "server.mjs");
}

async function healthcheck(): Promise<boolean> {
  const url = getServerUrl();
  // Wait up to 15 seconds for the server to start
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

export function registerServiceCommand(program: Command): void {
  const service = program
    .command("service")
    .description("Manage TrueCourse as a background service");

  service
    .command("install")
    .description("Install and start TrueCourse as a background service")
    .action(async () => {
      p.intro("Installing TrueCourse service");

      const platform = getPlatform();
      const serverPath = getServerPath();
      const logDir = getLogDir();
      const logPath = getLogPath();

      // Rotate logs before install
      rotateLogs(logDir);
      rotateErrorLogs(logDir);

      try {
        const installed = await platform.isInstalled();
        if (installed) {
          p.log.warn("Service is already installed. Use `truecourse service start` to start it.");
          return;
        }

        p.log.step("Installing service...");
        await platform.install(serverPath, logPath);

        p.log.step("Waiting for server to start...");
        const healthy = await healthcheck();
        if (healthy) {
          writeConfig({ runMode: "service" });
          const url = getServerUrl();
          p.log.success(`TrueCourse is running at ${url}`);
        } else {
          p.log.warn("Service installed but server hasn't responded yet.");
          p.log.info("Check logs with: truecourse service logs");
        }
      } catch (error: any) {
        p.log.error(`Failed to install service: ${error.message}`);
        process.exit(1);
      }

      p.outro("Service installed");
    });

  service
    .command("uninstall")
    .description("Stop and remove the TrueCourse background service")
    .action(async () => {
      p.intro("Uninstalling TrueCourse service");

      const platform = getPlatform();

      try {
        const installed = await platform.isInstalled();
        if (!installed) {
          p.log.warn("Service is not installed.");
          return;
        }

        p.log.step("Stopping and removing service...");
        await platform.uninstall();
        writeConfig({ runMode: "console" });
        p.log.success("Service removed. TrueCourse will run in console mode.");
      } catch (error: any) {
        p.log.error(`Failed to uninstall service: ${error.message}`);
        process.exit(1);
      }

      p.outro("Service uninstalled");
    });

  service
    .command("start")
    .description("Start the TrueCourse background service")
    .action(async () => {
      const platform = getPlatform();

      try {
        const installed = await platform.isInstalled();
        if (!installed) {
          p.log.error("Service is not installed. Run `truecourse service install` first.");
          process.exit(1);
        }

        const { running } = await platform.status();
        if (running) {
          const url = getServerUrl();
          p.log.info(`TrueCourse is already running at ${url}`);
          return;
        }

        // Rotate logs before start
        const logDir = getLogDir();
        rotateLogs(logDir);
        rotateErrorLogs(logDir);

        p.log.step("Starting service...");
        await platform.start();

        const healthy = await healthcheck();
        if (healthy) {
          const url = getServerUrl();
          p.log.success(`TrueCourse is running at ${url}`);
        } else {
          p.log.warn("Service started but server hasn't responded yet.");
          p.log.info("Check logs with: truecourse service logs");
        }
      } catch (error: any) {
        p.log.error(`Failed to start service: ${error.message}`);
        process.exit(1);
      }
    });

  service
    .command("stop")
    .description("Stop the TrueCourse background service")
    .action(async () => {
      const platform = getPlatform();

      try {
        const { running } = await platform.status();
        if (!running) {
          p.log.info("Service is not running.");
          return;
        }

        p.log.step("Stopping service...");
        await platform.stop();
        p.log.success("Service stopped.");
      } catch (error: any) {
        p.log.error(`Failed to stop service: ${error.message}`);
        process.exit(1);
      }
    });

  service
    .command("status")
    .description("Show the status of the TrueCourse background service")
    .action(async () => {
      const platform = getPlatform();

      try {
        const installed = await platform.isInstalled();
        if (!installed) {
          p.log.info("Service is not installed.");
          return;
        }

        const { running, pid } = await platform.status();
        if (running) {
          const pidInfo = pid ? ` (PID: ${pid})` : "";
          p.log.success(`Service is running${pidInfo}`);

          // Quick healthcheck
          const url = getServerUrl();
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
        } else {
          p.log.info("Service is installed but not running.");
        }
      } catch (error: any) {
        p.log.error(`Failed to get status: ${error.message}`);
        process.exit(1);
      }
    });

  service
    .command("logs")
    .description("Tail the TrueCourse service logs")
    .action(() => {
      tailLogs();
    });
}
