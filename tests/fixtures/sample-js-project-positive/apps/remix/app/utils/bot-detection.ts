
// --- regex-complexity FP: flat alternation of literal bot names, not structurally complex ---
// This is a simple alternation; no catastrophic backtracking risk
const BOT_DETECTOR_REGEX = /bot|facebookexternalhit|WhatsApp|google|bing|duckduckbot|MetaInspector/i;

function isBot(userAgent: string): boolean {
  return BOT_DETECTOR_REGEX.test(userAgent);
}

function shouldServeOgMeta(request: Request): boolean {
  const ua = request.headers.get('User-Agent') ?? '';
  return isBot(ua);
}
