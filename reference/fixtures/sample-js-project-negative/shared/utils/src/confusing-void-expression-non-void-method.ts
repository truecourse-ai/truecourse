// Paraphrased true-bug for code-quality/deterministic/confusing-void-expression.
//
// A class method whose signature claims `Promise<string>` accidentally
// returns the void result of a fire-and-forget helper. The call site
// looks like a real value is being forwarded; in fact the method
// silently returns `undefined`.

function pingDownstream(): void {
  // pretend to enqueue a ping
}

export class HealthcheckService {
  public async describe(): Promise<string> {
    const data = pingDownstream();
    // VIOLATION: code-quality/deterministic/confusing-void-expression
    return data;
  }
}
