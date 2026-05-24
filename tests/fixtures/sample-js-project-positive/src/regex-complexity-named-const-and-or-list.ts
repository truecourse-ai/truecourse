/**
 * Positive fixture for code-quality/deterministic/regex-complexity.
 *
 * Two long-but-not-actually-complex regex shapes that the rule should
 * not flag:
 *
 *   1. A flat alternation of literal strings — easy to read, no
 *      lookaheads, no backreferences, no nested groups. Length is
 *      irrelevant when structure is trivial.
 *   2. A long validator already pulled out into a top-level named
 *      `const` (or `export const`). The name documents intent, which
 *      is exactly what the rule's "extract to a named constant"
 *      recommendation asks for.
 */

// Flat alternation of crawler tokens — no parens, no lookaheads.
export function looksLikeCrawler(userAgent: string): boolean {
  return /bot|searchcrawler|webhookpinger|chartrender|metrics|previewfetcher|outboundsync/iu.test(
    userAgent,
  );
}

// Path-prefix OR-list bound to a named constant.
export const STATIC_PATH_REGEX =
  /^(?:\/api\/|\/ingest\/|\/__manifest|\/assets\/|\/apple-.*|\/favicon.*)/u;

// Anchored route-shape regex bound to a named constant.
export const EMBED_PATH_REGEX =
  /^\/(?:signin|forgot-password|check-email|unverified-account|sign|d)(?:\/|\.data|$)/u;

// Email-shaped validator with unicode ranges, bound to a named const.
export const EMAIL_VALIDATOR =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~\u{0080}-\u{FFFF}-]+@[a-zA-Z0-9\u{0080}-\u{FFFF}](?:[a-zA-Z0-9\u{0080}-\u{FFFF}-]{0,61}[a-zA-Z0-9\u{0080}-\u{FFFF}])?(?:\.[a-zA-Z0-9\u{0080}-\u{FFFF}](?:[a-zA-Z0-9\u{0080}-\u{FFFF}-]{0,61}[a-zA-Z0-9\u{0080}-\u{FFFF}])?)*$/u;

// Domain validator with lookaheads, bound to a named const.
export const DOMAIN_VALIDATOR =
  /^(?!https?:\/\/)(?!www\.)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/u;
