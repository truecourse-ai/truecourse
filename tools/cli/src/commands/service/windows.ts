import { execSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import type { ServicePlatform } from "./platform.js";
import { parseEnvFile } from "./env.js";

// Display name shown in the Services UI.
const SERVICE_DISPLAY_NAME = "TrueCourse";
// SCM service name node-windows actually registers under. It auto-derives
// this from the display name as `<sanitized lowercase>.exe`, ignoring any
// explicit `id` we set in the Service config (verified empirically). All
// sc.exe queries must use this exact string to find the service.
const SERVICE_SCM_NAME = "truecourse.exe";

export class WindowsService implements ServicePlatform {
  private async getNodeWindows(): Promise<any> {
    try {
      return require("node-windows");
    } catch {
      throw new Error(
        "node-windows is required for background service on Windows.\n" +
        "Install it with: npm install -g node-windows"
      );
    }
  }

  async install(serverPath: string, logPath: string): Promise<void> {
    const nw = await this.getNodeWindows();
    const { Service } = nw;
    const logDir = path.dirname(logPath);
    // Point the service at the invoking user's `.truecourse/` dir. Without
    // this the service runs as LocalSystem and `os.homedir()` resolves to
    // `C:\Windows\System32\config\systemprofile`, so the server reads an
    // empty registry / config tree and the dashboard shows no projects.
    const truecourseHome = path.join(os.homedir(), ".truecourse");
    const envFile = path.join(truecourseHome, ".env");

    // Merge ~/.truecourse/.env into the service's environment block so
    // service-mode installs honor PORT (and any future keys) the same way
    // launchd/systemd do via their native env-file mechanisms.
    const envFromFile = parseEnvFile(envFile);
    const fileEntries = Object.entries(envFromFile).map(([name, value]) => ({ name, value }));

    return new Promise<void>((resolve, reject) => {
      const svc = new Service({
        name: SERVICE_DISPLAY_NAME,
        description: "TrueCourse Server",
        script: serverPath,
        nodeOptions: [],
        // Land wrapper logs in our shared log dir (default is the
        // node-windows install dir, often inside an npx cache).
        logpath: logDir,
        env: [
          ...fileEntries,
          { name: "TRUECOURSE_HOME", value: truecourseHome },
          { name: "TRUECOURSE_LOG_DIR", value: logDir },
        ],
      });

      svc.on("install", () => {
        svc.start();
        resolve();
      });

      svc.on("error", (err: Error) => reject(err));
      svc.install();
    });
  }

  async uninstall(): Promise<void> {
    const nw = await this.getNodeWindows();
    const { Service } = nw;

    return new Promise<void>((resolve, reject) => {
      const svc = new Service({
        name: SERVICE_DISPLAY_NAME,
        script: "", // Not needed for uninstall
      });

      svc.on("uninstall", () => resolve());
      svc.on("error", (err: Error) => reject(err));
      svc.uninstall();
    });
  }

  async start(): Promise<void> {
    execSync(`sc.exe start ${SERVICE_SCM_NAME}`, { stdio: "pipe" });
  }

  async stop(): Promise<void> {
    execSync(`sc.exe stop ${SERVICE_SCM_NAME}`, { stdio: "pipe" });
  }

  async status(): Promise<{ running: boolean; pid?: number }> {
    try {
      const output = execSync(`sc.exe query ${SERVICE_SCM_NAME}`, {
        stdio: ["pipe", "pipe", "pipe"],
        encoding: "utf-8",
      });
      const running = output.includes("RUNNING");
      const pidMatch = output.match(/PID\s*:\s*(\d+)/);
      return {
        running,
        pid: pidMatch ? parseInt(pidMatch[1], 10) : undefined,
      };
    } catch {
      return { running: false };
    }
  }

  async isInstalled(): Promise<boolean> {
    try {
      execSync(`sc.exe query ${SERVICE_SCM_NAME}`, { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }
}
