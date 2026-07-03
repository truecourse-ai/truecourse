/**
 * Positive fixture for security/deterministic/timing-attack-comparison.
 *
 * `config.type === 'tokenBucket'` is a discriminated-union tag check: it
 * narrows a config object by its public `type` discriminator. The string
 * literal `'tokenBucket'` merely *contains* the substring "token"; it is not
 * a secret. A timing attack requires the compared value to be secret to the
 * attacker, and a public union tag never is — so flagging this `===` is a
 * false positive.
 */

interface TokenBucketConfig {
  type: 'tokenBucket';
  refillRate: number;
}

interface FixedWindowConfig {
  type: 'fixedWindow';
  limit: number;
}

type RateLimitConfig = TokenBucketConfig | FixedWindowConfig;

export function selectRefillRate(config: RateLimitConfig): number {
  return config.type === 'tokenBucket' ? config.refillRate : 0;
}
