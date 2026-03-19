import { execSync } from "node:child_process";
import type { ServicePlatform } from "./platform.js";

const SERVICE_NAME = "TrueCourse";

export class WindowsService implements ServicePlatform {
  private svc: any;

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

    return new Promise<void>((resolve, reject) => {
      const svc = new Service({
        name: SERVICE_NAME,
        description: "TrueCourse Server",
        script: serverPath,
        nodeOptions: [],
        env: [{
          name: "TRUECOURSE_LOG_DIR",
          value: logPath,
        }],
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
        name: SERVICE_NAME,
        script: "", // Not needed for uninstall
      });

      svc.on("uninstall", () => resolve());
      svc.on("error", (err: Error) => reject(err));
      svc.uninstall();
    });
  }

  async start(): Promise<void> {
    execSync(`sc.exe start ${SERVICE_NAME}`, { stdio: "pipe" });
  }

  async stop(): Promise<void> {
    execSync(`sc.exe stop ${SERVICE_NAME}`, { stdio: "pipe" });
  }

  async status(): Promise<{ running: boolean; pid?: number }> {
    try {
      const output = execSync(`sc.exe query ${SERVICE_NAME}`, {
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
      execSync(`sc.exe query ${SERVICE_NAME}`, { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }
}
