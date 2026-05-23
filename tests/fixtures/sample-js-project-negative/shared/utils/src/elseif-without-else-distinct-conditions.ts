// Paraphrased TP example for code-quality/deterministic/elseif-without-else.
//
// The chain mixes conditions on different variables — the missing else is
// a real silent-fallthrough hazard, not a closed-union narrowing.

interface Request {
  readonly userId: number | null;
  readonly anonymous: boolean;
}

// VIOLATION: code-quality/deterministic/elseif-without-else
export function classifyRequest(req: Request): string {
  let label = 'unknown';
  if (req.anonymous) {
    label = 'anonymous';
  } else if (req.userId !== null) {
    label = 'authenticated';
  }
  return label;
}
