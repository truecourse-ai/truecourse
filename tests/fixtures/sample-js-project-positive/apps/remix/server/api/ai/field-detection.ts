declare function streamText(ctx: object, fn: (stream: { writeln: (s: string) => Promise<void> }) => Promise<void>): object;
declare function detectFields(opts: object): Promise<object[]>;
declare const KEEPALIVE_MS: number;

export async function handleFieldDetection(c: object, envelopeId: string) {
  // streamText from hono/streaming is a sync utility returning a Response object, not an async function.
  // return without await is intentional and correct; no error-swallowing risk.
  return streamText(c, async (stream) => {
    let interval: ReturnType<typeof setInterval> | null = setInterval(() => {
      void stream.writeln(JSON.stringify({ type: 'keepalive' }));
    }, KEEPALIVE_MS);

    try {
      const fields = await detectFields({ envelopeId });

      for (const field of fields) {
        await stream.writeln(JSON.stringify({ type: 'field', field }));
      }
    } finally {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    }
  });
}
