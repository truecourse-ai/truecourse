import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  readTelemetryConfig,
  writeTelemetryConfig,
  showFirstRunNotice,
} from '../../tools/cli/src/telemetry';

let tmpDir: string;
const originalHome = process.env.HOME;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'truecourse-cli-telemetry-test-'));
  process.env.HOME = tmpDir;
});

afterEach(() => {
  process.env.HOME = originalHome;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Config read/write
// ---------------------------------------------------------------------------

describe('CLI readTelemetryConfig', () => {
  it('creates config with defaults when no file exists', () => {
    const config = readTelemetryConfig();
    expect(config.enabled).toBe(true);
    expect(config.noticeShown).toBe(false);
    expect(config.anonymousId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it('persists config to disk on first read', () => {
    readTelemetryConfig();
    const configPath = path.join(tmpDir, '.truecourse', 'telemetry.json');
    expect(fs.existsSync(configPath)).toBe(true);
  });

  it('preserves anonymousId across reads', () => {
    const first = readTelemetryConfig();
    const second = readTelemetryConfig();
    expect(first.anonymousId).toBe(second.anonymousId);
  });
});

describe('CLI writeTelemetryConfig', () => {
  it('merges partial updates', () => {
    const config = readTelemetryConfig();
    const originalId = config.anonymousId;

    writeTelemetryConfig({ enabled: false });
    const updated = readTelemetryConfig();
    expect(updated.enabled).toBe(false);
    expect(updated.anonymousId).toBe(originalId);
    expect(updated.noticeShown).toBe(false);
  });

  it('can update noticeShown independently', () => {
    readTelemetryConfig();
    writeTelemetryConfig({ noticeShown: true });
    const config = readTelemetryConfig();
    expect(config.noticeShown).toBe(true);
    expect(config.enabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// First-run notice
// ---------------------------------------------------------------------------

describe('showFirstRunNotice', () => {
  it('sets noticeShown to true after first call', () => {
    showFirstRunNotice();
    const config = readTelemetryConfig();
    expect(config.noticeShown).toBe(true);
  });

  it('does not reset noticeShown on subsequent calls', () => {
    showFirstRunNotice();
    showFirstRunNotice();
    const config = readTelemetryConfig();
    expect(config.noticeShown).toBe(true);
  });

  it('does not show notice when telemetry is disabled', () => {
    writeTelemetryConfig({ enabled: false });
    showFirstRunNotice();
    const config = readTelemetryConfig();
    // noticeShown should remain false since telemetry is disabled
    expect(config.noticeShown).toBe(false);
  });

  it('does not show notice when already shown', () => {
    writeTelemetryConfig({ noticeShown: true });
    // Should be a no-op
    showFirstRunNotice();
    const config = readTelemetryConfig();
    expect(config.noticeShown).toBe(true);
  });
});
