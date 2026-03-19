import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import type { ServicePlatform } from "./platform.js";

const SERVICE_NAME = "truecourse";
const UNIT_DIR = path.join(os.homedir(), ".config", "systemd", "user");
const UNIT_PATH = path.join(UNIT_DIR, `${SERVICE_NAME}.service`);

function buildUnitFile(serverPath: string, logPath: string): string {
  const envFile = path.join(os.homedir(), ".truecourse", ".env");
  const logDir = path.dirname(logPath);

  return `[Unit]
Description=TrueCourse Server
After=network.target

[Service]
Type=simple
ExecStart=${process.execPath} ${serverPath}
Restart=on-failure
RestartSec=5
EnvironmentFile=${envFile}
StandardOutput=append:${path.join(logDir, "truecourse.log")}
StandardError=append:${path.join(logDir, "truecourse.error.log")}

[Install]
WantedBy=default.target
`;
}

export class LinuxService implements ServicePlatform {
  async install(serverPath: string, logPath: string): Promise<void> {
    fs.mkdirSync(UNIT_DIR, { recursive: true });
    fs.mkdirSync(path.dirname(logPath), { recursive: true });

    const unit = buildUnitFile(serverPath, logPath);
    fs.writeFileSync(UNIT_PATH, unit, "utf-8");

    execSync("systemctl --user daemon-reload", { stdio: "pipe" });
    execSync(`systemctl --user enable ${SERVICE_NAME}`, { stdio: "pipe" });
  }

  async uninstall(): Promise<void> {
    try {
      execSync(`systemctl --user stop ${SERVICE_NAME}`, { stdio: "pipe" });
    } catch {
      // May already be stopped
    }
    try {
      execSync(`systemctl --user disable ${SERVICE_NAME}`, { stdio: "pipe" });
    } catch {
      // May already be disabled
    }
    if (fs.existsSync(UNIT_PATH)) {
      fs.unlinkSync(UNIT_PATH);
    }
    try {
      execSync("systemctl --user daemon-reload", { stdio: "pipe" });
    } catch {
      // Best effort
    }
  }

  async start(): Promise<void> {
    execSync(`systemctl --user start ${SERVICE_NAME}`, { stdio: "pipe" });
  }

  async stop(): Promise<void> {
    execSync(`systemctl --user stop ${SERVICE_NAME}`, { stdio: "pipe" });
  }

  async status(): Promise<{ running: boolean; pid?: number }> {
    try {
      const output = execSync(
        `systemctl --user show ${SERVICE_NAME} --property=ActiveState,MainPID`,
        { stdio: ["pipe", "pipe", "pipe"], encoding: "utf-8" }
      );
      const activeMatch = output.match(/ActiveState=(\w+)/);
      const pidMatch = output.match(/MainPID=(\d+)/);
      const isActive = activeMatch?.[1] === "active";
      const pid = pidMatch ? parseInt(pidMatch[1], 10) : undefined;
      return { running: isActive, pid: isActive && pid ? pid : undefined };
    } catch {
      return { running: false };
    }
  }

  async isInstalled(): Promise<boolean> {
    return fs.existsSync(UNIT_PATH);
  }
}
