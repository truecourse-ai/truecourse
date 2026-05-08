/**
 * CLI telemetry surface — config + first-run notice.
 *
 * Event capture itself lives in `@truecourse/core/services/telemetry`; this
 * file just re-exports the config helpers (so `truecourse telemetry
 * enable/disable/status` keep working) and prints the one-time notice.
 */

import * as p from "@clack/prompts";
import {
  readTelemetryConfig,
  writeTelemetryConfig,
  type TelemetryConfig,
} from "@truecourse/core/services/telemetry";

export { readTelemetryConfig, writeTelemetryConfig, type TelemetryConfig };

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
