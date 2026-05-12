/**
 * Time arithmetic patterns that should NOT trigger magic-number.
 *
 * The magic-number rule skips time conversion factors
 * when they appear in a multiplication chain with at least one other time factor.
 * Named constants with SCREAMING_SNAKE names are also skipped.
 */

const TIMEOUT_MS = 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const HALF_HOUR_MS = 30 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;

export function getTimeoutMs(): number {
  return TIMEOUT_MS;
}

export function getWeekMs(): number {
  return WEEK_MS;
}

export function getHalfHourMs(): number {
  return HALF_HOUR_MS;
}

export function getOneDayMs(): number {
  return ONE_DAY_MS;
}

export function getFiveMinutesMs(): number {
  return FIVE_MINUTES_MS;
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function isExpired(timestamp: number): boolean {
  return Date.now() - timestamp > ONE_DAY_MS;
}

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / MS_PER_SECOND);
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  return `${hours}h ${minutes % MINUTES_PER_HOUR}m ${seconds % SECONDS_PER_MINUTE}s`;
}



// --- non-number-arithmetic FP fixtures ---
// All arithmetic below operates on statically-typed `number` operands. The rule
// must NOT flag any of these as non-number arithmetic.

// Mode: konva-getclientrect-node-accessor
// Konva's Node.getClientRect() returns { x: number; y: number; width: number; height: number }
// and Node.x()/.y() accessors return numbers. Arithmetic against a number `scale`
// stays purely numeric.
declare const selectionRectangle: {
  getClientRect(): { x: number; y: number; width: number; height: number };
  x(): number;
  y(): number;
};
declare const pageData: { scale: number };
export function computeSelectionBox(): { left: number; top: number; right: number; bottom: number } {
  const box = selectionRectangle.getClientRect();
  const scale = pageData.scale;
  const left = box.x / scale;
  const top = box.y / scale;
  const right = (box.x + box.width) / scale;
  const bottom = (box.y + box.height) / scale;
  return { left, top, right, bottom };
}

// Mode: konva-pointer-position-scale-division
// Stage.getPointerPosition() returns Vector2d ({ x: number; y: number }) | null.
// After a null-check both fields are number, and dividing by a number `scale`
// yields a number.
declare const stage: { getPointerPosition(): { x: number; y: number } | null };
export function getPointerInPageCoords(scale: number): { x: number; y: number } | null {
  const pointerPosition = stage.getPointerPosition();
  if (pointerPosition === null) {
    return null;
  }
  const x = pointerPosition.x / scale;
  const y = pointerPosition.y / scale;
  const radius = (pointerPosition.x + pointerPosition.y) / scale;
  return { x: x + radius - radius, y };
}

// Mode: typed-number-param-nullish-coalescing-guard
// `column` and `row` are declared `number` (non-nullable). The `?? 0` guard is
// defensive only - operands remain numeric, so arithmetic is provably numeric.
export function fieldXForColumn(column: number, pageWidth: number): number {
  return (column ?? 0) * (pageWidth / 4) + 10;
}
export function fieldYForRow(row: number, pageHeight: number): number {
  return (row ?? 0) * (pageHeight / 6) + 20;
}

// Mode: numeric-literal-and-typed-constant-operands
// All operands are numeric literals, typed-number variables, or const-initialized
// to a number literal. Statically provable numeric arithmetic.
const VELOCITY_FILTER_WEIGHT = 0.5;
export function smoothVelocity(velocity: number, lastVelocity: number = 0): number {
  return VELOCITY_FILTER_WEIGHT * velocity + (1 - VELOCITY_FILTER_WEIGHT) * lastVelocity;
}
export function box2dCenter(box2d: [number, number, number, number]): { cx: number; cy: number } {
  const [xMin, yMin, xMax, yMax] = box2d;
  const cx = (xMax - xMin) / 10;
  const cy = (yMax - yMin) / 10;
  return { cx, cy };
}
