/**
 * Anonymous usage telemetry — single source of truth.
 *
 * Used automatically by `analyzeInProcess` / `diffInProcess`, so every adapter
 * (CLI, dashboard server, future hooks) reports without having to wire its own
 * call. Adapters only pass `source: 'cli' | 'dashboard'` so the event includes
 * the surface that triggered it.
 *
 * Config lives at `~/.truecourse/telemetry.json`. Set `TRUECOURSE_TELEMETRY=0`
 * or `CI=true` to disable for a process. `truecourse telemetry disable`
 * persists the opt-out.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PostHog } from 'posthog-node';
import type { AnalysisResult } from './analyzer.service.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface TelemetryConfig {
  enabled: boolean;
  anonymousId: string;
  /** CLI-only — tracks whether the first-run notice has been printed. */
  noticeShown: boolean;
}

const DEFAULT_CONFIG: TelemetryConfig = {
  enabled: true,
  anonymousId: '',
  noticeShown: false,
};

const POSTHOG_API_KEY = 'phc_ys9Ykf49KmNqAC3fhq3jugTejc4BDqyKqRS8qRoYZYew';

function getTelemetryConfigPath(): string {
  return path.join(os.homedir(), '.truecourse', 'telemetry.json');
}

export function readTelemetryConfig(): TelemetryConfig {
  const configPath = getTelemetryConfigPath();
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
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
    const raw = fs.readFileSync(configPath, 'utf-8');
    current = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    current = { ...DEFAULT_CONFIG };
  }

  const merged = { ...current, ...partial };
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// PostHog client
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

// Set by esbuild --define when building the published bundle (see
// scripts/build.ts). Workspace/dev runs have no replacement, so the
// `typeof` guard falls through to the file walk below.
declare const __TRUECOURSE_VERSION__: string;

let cachedVersion: string | null = null;

function readToolVersion(): string {
  if (cachedVersion) return cachedVersion;
  if (typeof __TRUECOURSE_VERSION__ !== 'undefined') {
    cachedVersion = __TRUECOURSE_VERSION__;
    return cachedVersion;
  }
  try {
    const here = fileURLToPath(import.meta.url);
    const pkgPath = path.resolve(path.dirname(here), '..', '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    cachedVersion = String(pkg.version ?? '0.0.0');
  } catch {
    cachedVersion = '0.0.0';
  }
  return cachedVersion;
}

export function getSystemInfo(): { os: string; version: string } {
  return {
    os: `${process.platform}-${process.arch}`,
    version: readToolVersion(),
  };
}

// ---------------------------------------------------------------------------
// Event tracking
// ---------------------------------------------------------------------------

export type TelemetrySource = 'cli' | 'dashboard';

export async function trackEvent(
  event: string,
  properties: Record<string, unknown>,
): Promise<void> {
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
    // PostHog buffers + flushes async; await flush so short-lived CLI
    // processes don't exit before the event hits the wire.
    await client.flush();
  } catch {
    // Silently ignore — telemetry must never break the app.
  }
}

export async function shutdownTelemetry(): Promise<void> {
  if (!posthogClient) return;
  try {
    await posthogClient.shutdown();
  } catch {
    // ignore
  }
  posthogClient = null;
}
