// enum-exhaustive-record-lookup: Record keyed by expiry type, key checked via ternary
type ExpiryPreset = '7d' | '30d' | '90d' | '365d';

type DurationMs = { milliseconds: number };

const expiryDurations: Record<ExpiryPreset, DurationMs> = {
  '7d': { milliseconds: 7 * 24 * 60 * 60 * 1000 },
  '30d': { milliseconds: 30 * 24 * 60 * 60 * 1000 },
  '90d': { milliseconds: 90 * 24 * 60 * 60 * 1000 },
  '365d': { milliseconds: 365 * 24 * 60 * 60 * 1000 },
};

declare function nowPlusMs(ms: number): Date;

function resolveTokenExpiry(expiresIn: ExpiryPreset | null): Date | null {
  return expiresIn ? nowPlusMs(expiryDurations[expiresIn].milliseconds) : null;
}
