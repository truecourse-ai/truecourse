import { logger } from '@sample/shared-utils';
const TEST_PATTERN = /^test/u;
export function matchPattern(item: string): boolean {
  return TEST_PATTERN.test(item);
}
export function chunkArray(arr: readonly number[], size: number): number[][] {
  const chunks: number[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
export function logMessage(msg: string): void {
  logger.info(msg);
}
export function groupByCategory(items: readonly { id: string; category: string }[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const item of items) {
    const list = map.get(item.category) || [];
    list.push(item.id);
    map.set(item.category, list);
  }
  return map;
}



// --- raw-error-in-response shape: sanitized-error-response (ERROR_CODES enum lookup, not raw error) ---
declare const LICENSE_ERROR_CODES: Record<string, string>;

async function checkPlanLimits(
  teamId: string,
  feature: string
): Promise<{ allowed: boolean; limitCode?: string }> {
  try {
    const plan = await getTeamPlan(teamId);
    const allowed = isPlanFeatureAllowed(plan, feature);
    return { allowed };
  } catch (err) {
    console.error('Plan limit check failed:', err);
    // Response uses ERROR_CODES[err.message] (safe enum constant) or UNKNOWN
    // Raw error object is NEVER in the response body
    const code = err instanceof Error && LICENSE_ERROR_CODES[err.message]
      ? LICENSE_ERROR_CODES[err.message]
      : LICENSE_ERROR_CODES['UNKNOWN'];
    return { allowed: false, limitCode: code };
  }
}

declare function getTeamPlan(teamId: string): Promise<{ tier: string; features: string[] }>;
declare function isPlanFeatureAllowed(plan: { tier: string; features: string[] }, feature: string): boolean;



// PDF page orientation helpers - 90 and 270 are standard landscape rotation degrees
function isLandscapeOrientation(pageRotationInDegrees: number): boolean {
  return pageRotationInDegrees === 90 || pageRotationInDegrees === 270;
}

export function getPageDimensions(
  width: number,
  height: number,
  pageRotationInDegrees: number
): { width: number; height: number } {
  if (isLandscapeOrientation(pageRotationInDegrees)) {
    return { width: height, height: width };
  }
  return { width, height };
}



// Unit conversion: SI megabytes to bytes - 1000000 is universally known SI prefix
export function megabytesToBytes(megabytes: number): number {
  return megabytes * 1000000;
}

export function kilobytesToBytes(kilobytes: number): number {
  return kilobytes * 1000;
}



// PDF orientation: 180 degrees is a self-evident half-turn rotation
function isUpsideDown(pageRotationInDegrees: number): boolean {
  return pageRotationInDegrees === 180;
}

export function normalizePageRotation(
  rotationDegrees: number,
  contentX: number,
  contentY: number,
  pageWidth: number,
  pageHeight: number
): { x: number; y: number } {
  if (isUpsideDown(rotationDegrees)) {
    return { x: pageWidth - contentX, y: pageHeight - contentY };
  }
  return { x: contentX, y: contentY };
}



// RGB normalization: dividing by 255 converts 0-255 channel to 0.0-1.0 float range
declare function rgb(r: number, g: number, b: number): unknown;

export function createRejectionStampColor(): unknown {
  // Standard red color: rgb(220, 38, 38) normalized to 0-1 range
  return rgb(220 / 255, 38 / 255, 38 / 255);
}

export function createWarningColor(): unknown {
  return rgb(234 / 255, 179 / 255, 8 / 255);
}



// Grid index computation: row * 3 + column for a 3-column grid layout
export function computeGridIndex(row: number, column: number): number {
  return row * 3 + column;
}

export function buildFieldGrid(fields: string[]): string[][] {
  const rows: string[][] = [];
  for (let i = 0; i < fields.length; i++) {
    const row = Math.floor(i / 3);
    const col = i % 3;
    if (!rows[row]) rows[row] = [];
    rows[row][col] = fields[i] ?? '';
  }
  return rows;
}



// File size limit: named constant * 1024 * 1024 converts MB to bytes (binary MB unit)
declare const APP_DOCUMENT_UPLOAD_SIZE_LIMIT: number;

export function isFileTooLarge(fileSize: number): boolean {
  return fileSize > APP_DOCUMENT_UPLOAD_SIZE_LIMIT * 1024 * 1024;
}



// 1024 * 1024 is the universally known binary megabyte constant in file size display
export function formatFileSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(2)} MB`;
}

export function getBinaryMegabytes(bytes: number): number {
  return bytes / (1024 * 1024);
}



// 5 * 1024 * 1024 = 5MB file size limit; 1024 is universally known binary unit
export const MAX_SIGNATURE_UPLOAD_SIZE = 5 * 1024 * 1024;

export function isSignatureFileTooLarge(fileSize: number): boolean {
  return fileSize > 5 * 1024 * 1024;
}



// 4 * 1024 * 1024 = 4MB CSV file limit; 1024 is a universally known binary unit
export const MAX_CSV_IMPORT_SIZE = 4 * 1024 * 1024;

export function isCsvFileTooLarge(fileSize: number): boolean {
  return fileSize > 4 * 1024 * 1024;
}



// pageRotationInDegrees === 270 tests landscape rotation; 270 is a standard orientation value
function isCounterClockwiseLandscape(pageRotationInDegrees: number): boolean {
  return pageRotationInDegrees === 270;
}

export function adjustFieldCoordinatesForRotation(
  x: number,
  y: number,
  pageWidth: number,
  pageHeight: number,
  pageRotationInDegrees: number
): { x: number; y: number } {
  if (isCounterClockwiseLandscape(pageRotationInDegrees)) {
    return { x: y, y: pageWidth - x };
  }
  return { x, y };
}
