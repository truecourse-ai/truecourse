// The error-first callback reports its error through an object-shorthand
// property (`{ error }`) passed to the logger. That is a real use of the
// parameter — the error is logged, not silently swallowed — so this must not
// be flagged.

declare function logEvent(message: string, context: Record<string, unknown>): void;
declare const emitter: {
  on(event: string, handler: (error: Error, meta: { url: string }) => void): void;
};

export function register(): void {
  emitter.on("request", (error, meta) => {
    logEvent("request failed", { error, url: meta.url });
  });
}
