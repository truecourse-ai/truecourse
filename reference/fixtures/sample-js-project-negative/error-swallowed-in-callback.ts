// The error-first callback receives `err` but never checks or uses it — the
// data is processed while failures are silently swallowed.

declare function writeOut(line: string): void;
declare const emitter: {
  on(event: string, handler: (err: Error, data: string) => void): void;
};

export function listen(): void {
  // VIOLATION: bugs/deterministic/error-swallowed-in-callback
  emitter.on("data", (err, data) => {
    writeOut(data);
  });
}
