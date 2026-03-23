import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import type { ServicePlatform } from "./platform.js";
import { parseEnvFile } from "./env.js";

const SERVICE_LABEL = "com.truecourse.server";
const PLIST_DIR = path.join(os.homedir(), "Library", "LaunchAgents");
const PLIST_PATH = path.join(PLIST_DIR, `${SERVICE_LABEL}.plist`);

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildPlist(serverPath: string, logPath: string, envVars: Record<string, string>): string {
  const stdoutPath = path.join(path.dirname(logPath), "truecourse.log");
  const stderrPath = path.join(path.dirname(logPath), "truecourse.error.log");

  let envSection = "";
  if (Object.keys(envVars).length > 0) {
    const entries = Object.entries(envVars)
      .map(([k, v]) => `      <key>${escapeXml(k)}</key>\n      <string>${escapeXml(v)}</string>`)
      .join("\n");
    envSection = `
    <key>EnvironmentVariables</key>
    <dict>
${entries}
    </dict>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${SERVICE_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${escapeXml(process.execPath)}</string>
        <string>${escapeXml(serverPath)}</string>
    </array>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${escapeXml(stdoutPath)}</string>
    <key>StandardErrorPath</key>
    <string>${escapeXml(stderrPath)}</string>${envSection}
</dict>
</plist>
`;
}

export class MacOSService implements ServicePlatform {
  async install(serverPath: string, logPath: string): Promise<void> {
    const envFile = path.join(os.homedir(), ".truecourse", ".env");
    const envVars = parseEnvFile(envFile);

    // Include PATH so the service can find binaries like `claude`
    if (process.env.PATH && !envVars.PATH) {
      envVars.PATH = process.env.PATH;
    }

    fs.mkdirSync(PLIST_DIR, { recursive: true });
    fs.mkdirSync(path.dirname(logPath), { recursive: true });

    const plist = buildPlist(serverPath, logPath, envVars);
    fs.writeFileSync(PLIST_PATH, plist, "utf-8");

    execSync(`launchctl load -w "${PLIST_PATH}"`, { stdio: "pipe" });
  }

  async uninstall(): Promise<void> {
    try {
      execSync(`launchctl unload "${PLIST_PATH}"`, { stdio: "pipe" });
    } catch {
      // May already be unloaded
    }
    if (fs.existsSync(PLIST_PATH)) {
      fs.unlinkSync(PLIST_PATH);
    }
  }

  async start(): Promise<void> {
    execSync(`launchctl start ${SERVICE_LABEL}`, { stdio: "pipe" });
  }

  async stop(): Promise<void> {
    execSync(`launchctl stop ${SERVICE_LABEL}`, { stdio: "pipe" });
  }

  async status(): Promise<{ running: boolean; pid?: number }> {
    try {
      const output = execSync(`launchctl list ${SERVICE_LABEL}`, {
        stdio: ["pipe", "pipe", "pipe"],
        encoding: "utf-8",
      });
      // Parse PID from output - format: "PID" = <number>; or first column in list
      const pidMatch = output.match(/"PID"\s*=\s*(\d+)/);
      if (pidMatch) {
        return { running: true, pid: parseInt(pidMatch[1], 10) };
      }
      // Alternative: check if the process is in the list output
      // launchctl list <label> shows { "LimitLoadToSessionType" = ...; "PID" = 1234; ... }
      // If no PID key, the service is loaded but not running
      if (output.includes('"PID"')) {
        return { running: true };
      }
      return { running: false };
    } catch {
      return { running: false };
    }
  }

  async isInstalled(): Promise<boolean> {
    return fs.existsSync(PLIST_PATH);
  }
}
