import * as p from "@clack/prompts";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface TelemetryConfig {
  enabled: boolean;
  anonymousId: string;
  noticeShown: boolean;
}

const DEFAULT_CONFIG: TelemetryConfig = {
  enabled: true,
  anonymousId: "",
  noticeShown: false,
};

function getTelemetryConfigPath(): string {
  return path.join(os.homedir(), ".truecourse", "telemetry.json");
}

export function readTelemetryConfig(): TelemetryConfig {
  const configPath = getTelemetryConfigPath();
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    const config = { ...DEFAULT_CONFIG, ...parsed };
    if (!config.anonymousId) {
      config.anonymousId = crypto.randomUUID();
      writeTelemetryConfig(config);
    }
    return config;
  } catch {
    const config: TelemetryConfig = {
      enabled: true,
      anonymousId: crypto.randomUUID(),
      noticeShown: false,
    };
    writeTelemetryConfig(config);
    return config;
  }
}

export function writeTelemetryConfig(partial: Partial<TelemetryConfig>): void {
  const configPath = getTelemetryConfigPath();
  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true });

  let current: TelemetryConfig;
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    current = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    current = { ...DEFAULT_CONFIG };
  }

  const merged = { ...current, ...partial };
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2) + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// First-run notice
// ---------------------------------------------------------------------------

export function showFirstRunNotice(): void {
  try {
    const config = readTelemetryConfig();
    if (!config.enabled || config.noticeShown) return;

    p.log.info(
      "TrueCourse collects anonymous usage data to improve the product. " +
      "Run `npx truecourse telemetry disable` to opt out."
    );
    writeTelemetryConfig({ noticeShown: true });
  } catch {
    // Never break the CLI for telemetry
  }
}
