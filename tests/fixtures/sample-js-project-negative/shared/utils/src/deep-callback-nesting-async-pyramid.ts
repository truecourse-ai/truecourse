// Paraphrased true-bug for code-quality/deterministic/deep-callback-nesting.
//
// Four continuation-style callbacks, each passed as the direct argument of
// the next call — the classic "pyramid of doom". This is exactly the shape
// the rule targets; it should be flattened with async/await or named
// functions.

declare function openConnection(url: string, cb: (handle: string) => void): void;
declare function authenticate(handle: string, cb: (token: string) => void): void;
declare function loadSession(token: string, cb: (sessionId: string) => void): void;
declare function fetchProfile(sessionId: string, cb: (name: string) => void): void;
declare function record(name: string): void;

export function bootstrapProfile(url: string): void {
  openConnection(url, (handle) => {
    authenticate(handle, (token) => {
      loadSession(token, (sessionId) => {
        // VIOLATION: code-quality/deterministic/deep-callback-nesting
        fetchProfile(sessionId, (name) => {
          record(name);
        });
      });
    });
  });
}
