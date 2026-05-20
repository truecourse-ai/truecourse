// Positive fixture for unhandled-rejection-no-handler /
// uncaught-exception-no-handler on Remix route modules.
//
// Remix route modules are imported by the Remix runtime; they are NOT
// process entry-points and must not be required to register process-level
// `unhandledRejection` / `uncaughtException` handlers. The basename pattern
// `_index.tsx` is what triggered the FP — the old visitor matched any path
// containing `index.`.

declare function readSomething(): Promise<string>;
declare function writeSomething(): Promise<void>;

export const loader = async (): Promise<{ value: string }> => {
  const value = await readSomething();
  return { value };
};

export const action = async (): Promise<{ ok: true }> => {
  await writeSomething();
  return { ok: true };
};

export default function RouteComponent(): null {
  return null;
}
