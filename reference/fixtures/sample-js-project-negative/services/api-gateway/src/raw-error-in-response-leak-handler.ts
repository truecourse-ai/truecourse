interface Response {
  status(code: number): Response;
  json(payload: unknown): void;
}

export function reportFailureHandler(_req: unknown, res: Response): void {
  try {
    JSON.parse("not json");
  } catch (err) {
    // VIOLATION: architecture/deterministic/raw-error-in-response
    res.status(500).json({ failure: err.message, trace: err.stack });
  }
}
