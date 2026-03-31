import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { PostHog } from 'posthog-node';
import type { AnalysisResult } from './analyzer.service.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface TelemetryConfig {
  enabled: boolean;
  anonymousId: string;
}

const DEFAULT_CONFIG: TelemetryConfig = {
  enabled: true,
  anonymousId: '',
};

const POSTHOG_API_KEY = 'phc_ys9Ykf49KmNqAC3fhq3jugTejc4BDqyKqRS8qRoYZYew';
const TOOL_VERSION = '0.2.2';

function getTelemetryConfigPath(): string {
  return path.join(os.homedir(), '.truecourse', 'telemetry.json');
}

export function readTelemetryConfig(): TelemetryConfig {
  const configPath = getTelemetryConfigPath();
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const config = { ...DEFAULT_CONFIG, ...parsed };
    // Ensure anonymousId is always set
    if (!config.anonymousId) {
      config.anonymousId = crypto.randomUUID();
      writeTelemetryConfig(config);
    }
    return config;
  } catch {
    // First time — generate config with new anonymous ID
    const config: TelemetryConfig = {
      enabled: true,
      anonymousId: crypto.randomUUID(),
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
    const raw = fs.readFileSync(configPath, 'utf-8');
    current = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    current = { ...DEFAULT_CONFIG };
  }

  const merged = { ...current, ...partial };
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// Telemetry state
// ---------------------------------------------------------------------------

let posthogClient: PostHog | null = null;

function isTelemetryEnabled(): boolean {
  if (!POSTHOG_API_KEY) return false;
  if (process.env.CI === 'true') return false;
  if (process.env.TRUECOURSE_TELEMETRY === '0') return false;
  const config = readTelemetryConfig();
  return config.enabled;
}

function getPostHogClient(): PostHog {
  if (!posthogClient) {
    posthogClient = new PostHog(POSTHOG_API_KEY, {
      flushAt: 1,
      flushInterval: 0,
    });
  }
  return posthogClient;
}

// ---------------------------------------------------------------------------
// Bucketing helpers
// ---------------------------------------------------------------------------

export function bucketFileCount(count: number): string {
  if (count <= 50) return '1-50';
  if (count <= 200) return '50-200';
  if (count <= 500) return '200-500';
  return '500+';
}

export function bucketDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 5) return '<5s';
  if (seconds < 15) return '5-15s';
  if (seconds < 60) return '15-60s';
  if (seconds < 300) return '1-5m';
  return '5m+';
}

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.cs': 'csharp',
  '.go': 'go',
  '.java': 'java',
  '.rb': 'ruby',
  '.rs': 'rust',
};

export function detectLanguages(result: AnalysisResult): string[] {
  const languages = new Set<string>();
  for (const service of result.services) {
    for (const filePath of service.files) {
      const ext = path.extname(filePath).toLowerCase();
      const lang = EXTENSION_TO_LANGUAGE[ext];
      if (lang) languages.add(lang);
    }
  }
  return Array.from(languages).sort();
}

// ---------------------------------------------------------------------------
// System info
// ---------------------------------------------------------------------------

export function getSystemInfo(): { os: string; version: string } {
  return {
    os: `${process.platform}-${process.arch}`,
    version: TOOL_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Event tracking
// ---------------------------------------------------------------------------

export function trackEvent(event: string, properties: Record<string, unknown>): void {
  try {
    if (!isTelemetryEnabled()) return;

    const config = readTelemetryConfig();
    const client = getPostHogClient();
    const systemInfo = getSystemInfo();

    client.capture({
      distinctId: config.anonymousId,
      event,
      properties: {
        ...properties,
        toolVersion: systemInfo.version,
        os: systemInfo.os,
      },
    });
  } catch {
    // Silently ignore — telemetry must never break the app
  }
}
