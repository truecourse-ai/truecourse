// Paraphrased positive fixture for code-quality/deterministic/prefer-immediate-return.
//
// When the assigned expression is a large builder — e.g. a constructor
// call whose argument literal carries dozens of inline handler bodies —
// keeping the temporary binding is a readability win. Inlining a
// hundred-line `new Connection({ handlers: { … } })` into the `return`
// strictly hurts clarity, which is the opposite of what this rule
// should encourage.

interface BuilderConfig {
  namespace: string;
  host: string;
  port: number;
  authToken: string;
  handlers: Record<string, (message: string) => Promise<void>>;
}

class WireBuilder {
  constructor(_cfg: BuilderConfig) {
    // pretend to wire up sockets
  }
}

export function buildWire(host: string, port: number, authToken: string): WireBuilder {
  const wire = new WireBuilder({
    namespace: 'coordinator',
    host,
    port,
    authToken,
    handlers: {
      RESUME_AFTER_DEPENDENCY: async (_message: string) => {
        await Promise.resolve();
      },
      RESUME_AFTER_DURATION: async (_message: string) => {
        await Promise.resolve();
      },
      CRASH_TASK: async (_message: string) => {
        await Promise.resolve();
      },
      CANCEL_TASK: async (_message: string) => {
        await Promise.resolve();
      },
      CHECKPOINT_CREATED: async (_message: string) => {
        await Promise.resolve();
      },
      READY_FOR_RESUME: async (_message: string) => {
        await Promise.resolve();
      },
    },
  });

  return wire;
}
